import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createShipment, fetchLabel, login } from '@/lib/tipsa/client'
import { buildPublicTrackingUrl, loadTipsaConfig } from '@/lib/tipsa/services'
import { validateShipmentBody } from '@/lib/shipments/validate-payload'
import { upsertAddressFromOrder } from '@/lib/address-book/upsert'
import { canCreateFreeShipment } from '@/lib/auth'
import type { Shipment, UserRole } from '@/types/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SELECT =
  'id, shipment_id, status, created_at, updated_at, created_by, sender_name, sender_address, sender_cp, sender_city, sender_phone, recipient_name, recipient_address, recipient_cp, recipient_city, recipient_phone, recipient_email, recipient_contact_person, service_code, packages, weight_kg, content, observations, return_shipment, saturday_delivery, reference, albaran, tracking_number, tracking_public_url, carrier_guid, tracking_last_status, tracking_last_checked_at, shipped_at, delivered_at, shipping_label_url, notes'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

// ===========================================
// GET /api/shipments — listado paginado
// ===========================================
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') ?? '').trim()
  const limit = clampInt(searchParams.get('limit'), 1, MAX_LIMIT, DEFAULT_LIMIT)
  const page = clampInt(searchParams.get('page'), 1, 10000, 1)
  const offset = (page - 1) * limit

  let query = supabase
    .from('shipments')
    .select(SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (q) {
    // Busqueda simple multi-campo. `albaran` y `tracking_number` guardan los
    // dos el numero de albaran de TIPSA (se escriben juntos al crear el envio,
    // mas abajo en este mismo fichero), pero se buscan los dos: el refresco de
    // TIPSA solo mantiene tracking_number, y un envio que llegue por otra via
    // puede tener uno sin el otro.
    const safe = q.replace(/[,()"%]/g, ' ').trim()
    if (safe) {
      const fragment = `%${safe}%`
      query = query.or(
        [
          `shipment_id.ilike.${fragment}`,
          `sender_name.ilike.${fragment}`,
          `recipient_name.ilike.${fragment}`,
          `albaran.ilike.${fragment}`,
          `tracking_number.ilike.${fragment}`,
        ].join(','),
      )
    }
  }

  const { data, error, count } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    shipments: (data ?? []) as Shipment[],
    total: count ?? 0,
    page,
    limit,
  })
}

// ===========================================
// POST /api/shipments — crear envio libre
// ===========================================
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!canCreateFreeShipment(profile?.role as UserRole | undefined)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
  }

  const validation = validateShipmentBody(raw)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }
  const body = validation.data

  const admin = createAdminClient()

  // 1. Crear shipment en BD primero (genera shipment_id auto).
  const { data: created, error: insertError } = await admin
    .from('shipments')
    .insert({
      sender_name: body.sender.name,
      sender_address: body.sender.address,
      sender_cp: body.sender.cp,
      sender_city: body.sender.city,
      sender_phone: body.sender.phone ?? null,
      recipient_name: body.recipient.name,
      recipient_address: body.recipient.address,
      recipient_cp: body.recipient.cp,
      recipient_city: body.recipient.city,
      recipient_phone: body.recipient.phone ?? null,
      recipient_email: body.recipient.email ?? null,
      recipient_contact_person: body.recipient.contact_person ?? null,
      service_code: body.service_code,
      packages: body.packages ?? 1,
      weight_kg: body.weight_kg ?? 1,
      content: body.content ?? null,
      observations: body.observations ?? null,
      return_shipment: body.return_shipment ?? false,
      saturday_delivery: body.saturday_delivery ?? false,
      reference: body.reference ?? null,
      notes: body.notes ?? null,
      created_by: user.id,
    })
    .select(SELECT)
    .single()

  if (insertError || !created) {
    return NextResponse.json(
      { error: insertError?.message ?? 'Error creando shipment' },
      { status: 500 },
    )
  }

  const shipment = created as Shipment

  // 2. Llamar a TIPSA con sender override.
  let tipsaConfig
  try {
    tipsaConfig = loadTipsaConfig()
  } catch (err) {
    return NextResponse.json(
      { error: 'TIPSA no configurada', detail: (err as Error).message },
      { status: 500 },
    )
  }
  const configWithSender = {
    ...tipsaConfig,
    sender: {
      name: body.sender.name,
      address: body.sender.address,
      city: body.sender.city,
      cp: body.sender.cp,
      phone: body.sender.phone ?? '',
    },
  }

  try {
    const loginInfo = await login(configWithSender)

    const shipResult = await createShipment(configWithSender, {
      serviceCode: body.service_code,
      packages: body.packages ?? 1,
      weightKg: body.weight_kg ?? 1,
      content: body.content ?? 'Envio libre',
      observations: body.observations ?? undefined,
      reference: body.reference ?? shipment.shipment_id,
      returnShipment: body.return_shipment ?? false,
      saturdayDelivery: body.saturday_delivery ?? false,
      recipient: {
        name: body.recipient.name,
        address: body.recipient.address,
        city: body.recipient.city,
        cp: body.recipient.cp,
        phone: body.recipient.phone ?? '',
        email: body.recipient.email ?? undefined,
        country: 'ES',
        contactPerson: body.recipient.contact_person ?? body.recipient.name,
      },
    })

    const publicUrl = buildPublicTrackingUrl(
      loginInfo.trackingBaseUrl,
      shipResult.guid,
      new Date(),
    )

    // 3. Descargar etiqueta PDF.
    const label = await fetchLabel(configWithSender, shipResult.albaran, 'pdf')
    const labelPath = `shipment_${shipment.id}/${shipResult.albaran}.pdf`
    const pdfBuffer = Buffer.from(label.base64, 'base64')

    const { error: uploadError } = await admin.storage
      .from('shipping-labels')
      .upload(labelPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      })
    if (uploadError) {
      console.error('[shipments] upload label error:', uploadError.message)
    }

    const { data: signed } = await admin.storage
      .from('shipping-labels')
      .createSignedUrl(labelPath, 60 * 60 * 24 * 7)
    const shippingLabelUrl = signed?.signedUrl ?? null

    // 4. Update shipment con datos TIPSA.
    const now = new Date().toISOString()
    const { data: updated, error: updateError } = await admin
      .from('shipments')
      .update({
        albaran: shipResult.albaran,
        carrier_guid: shipResult.guid,
        tracking_number: shipResult.albaran,
        tracking_public_url: publicUrl,
        shipping_label_url: shippingLabelUrl,
        shipped_at: now,
        tracking_last_status: '0',
        tracking_last_checked_at: now,
      })
      .eq('id', shipment.id)
      .select(SELECT)
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // 5. Evento inicial. Codigo 0 = DOCUMENTADO, lo mismo que emite TIPSA al
    // dar de alta el envio. Ver la nota en tipsa/create-shipment/route.ts:
    // antes usabamos el 1, que en el catalogo oficial es TRANSITO.
    await admin.from('shipping_events').insert({
      shipment_id: shipment.id,
      carrier: 'tipsa',
      event_code: '0',
      event_label: 'Documentado',
      event_date: now,
      raw_payload: { albaran: shipResult.albaran, guid: shipResult.guid },
    })

    // 6. Auto-add a address_book sender + recipient (silencia errores).
    void upsertAddressFromOrder(admin, {
      name: body.sender.name,
      address: body.sender.address,
      cp: body.sender.cp,
      city: body.sender.city,
      phone: body.sender.phone ?? null,
      created_by: user.id,
    })
    void upsertAddressFromOrder(admin, {
      name: body.recipient.name,
      address: body.recipient.address,
      cp: body.recipient.cp,
      city: body.recipient.city,
      phone: body.recipient.phone ?? null,
      email: body.recipient.email ?? null,
      contact_person: body.recipient.contact_person ?? null,
      created_by: user.id,
    })

    return NextResponse.json({ shipment: updated as Shipment }, { status: 201 })
  } catch (err) {
    // Si TIPSA falla, dejamos el shipment creado pero sin etiqueta.
    // El usuario puede borrar y reintentar, o el admin puede intentar
    // reemitir la etiqueta. Este compromiso evita perder los datos
    // tecleados si TIPSA esta caida.
    const error = err as Error
    return NextResponse.json(
      {
        error: 'Error consultando TIPSA',
        detail: error.message,
        shipment: shipment,
      },
      { status: 502 },
    )
  }
}
