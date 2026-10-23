import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchTracking, fetchTrackingDeltas } from '@/lib/tipsa/client'
import {
  isTerminalEvent,
  loadTipsaConfig,
  resolveOfficialStatus,
} from '@/lib/tipsa/services'
import { refreshTrackedPickups } from '@/lib/pickups/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// El sweep hace N queries a Supabase; damos margen por si hay muchos deltas.
export const maxDuration = 60

// TIPSA rechaza ventanas de mas de 24h en ConsEnvEstIncCambiosEstados
// ("El rango de fechas no puede superar las 24 horas"). Dejamos 30 min de
// colchon para no rozar el limite por desfase de reloj.
const MAX_WINDOW_MS = 23.5 * 3600 * 1000
// Solape hacia atras sobre el cursor para no perder eventos por ese desfase.
const OVERLAP_MS = 5 * 60 * 1000

/**
 * POST /api/cron/tipsa-refresh
 *
 * Sweep periodico del estado de los envios TIPSA. Lo dispara pg_cron desde
 * Supabase cada 30 min (migracion 20260909000003) via net.http_post, con la
 * cabecera X-Cron-Secret leida del Vault.
 *
 * Por que vive aqui y no en una Edge Function: Vercel ya tiene configuradas
 * las credenciales TIPSA (las usa /api/tipsa/create-shipment), asi que no hay
 * que duplicarlas en Supabase. Ademas reutiliza lib/tipsa/client.ts en vez de
 * mantener un segundo cliente SOAP escrito para Deno.
 *
 * Flujo:
 *   1. Auth por X-Cron-Secret.
 *   2. Lee app_settings.tipsa_last_poll_at (cursor).
 *   3. Pide a TIPSA que albaranes han cambiado de estado en la ventana
 *      [cursor-5min, now] con UNA llamada paginada
 *      (ConsEnvEstIncCambiosEstados). Ese feed se usa SOLO como detector: sus
 *      fechas son de propagacion, no del evento, asi que no valen de historial.
 *   4. Para cada albaran movido pide su historial autoritativo
 *      (ConsEnvEstados), lo inserta en shipping_events, recalcula el estado
 *      oficial y actualiza orders/shipments.
 *   5. Guarda el nuevo cursor.
 */
export async function POST(request: NextRequest) {
  const started = Date.now()

  const expected = process.env.TIPSA_CRON_SECRET
  if (!expected) {
    console.error('[cron/tipsa-refresh] TIPSA_CRON_SECRET no configurada')
    return NextResponse.json(
      { error: 'Endpoint no disponible (config)' },
      { status: 503 },
    )
  }
  if ((request.headers.get('x-cron-secret') ?? '') !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  try {
    // ---- 1. Cursor ----
    const { data: setting, error: settingErr } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'tipsa_last_poll_at')
      .maybeSingle()
    if (settingErr) throw new Error(`app_settings read: ${settingErr.message}`)

    const now = new Date()
    const lastPollRaw = setting?.value
    const lastPoll =
      typeof lastPollRaw === 'string'
        ? new Date(lastPollRaw)
        : new Date(now.getTime() - MAX_WINDOW_MS)

    // 5 min de solape hacia atras: el UNIQUE de shipping_events descarta lo
    // repetido y asi no perdemos eventos por desfase de reloj con TIPSA.
    const desiredSince = new Date(lastPoll.getTime() - OVERLAP_MS)
    // TIPSA rechaza ventanas > 24h ("El rango de fechas no puede superar las
    // 24 horas"), asi que la recortamos. Si el cron ha estado parado mas de un
    // dia, esta pasada solo cubre las ultimas 23h; el resto se recupera
    // pulsando "Actualizar" en la ficha del envio concreto.
    const earliestAllowed = new Date(now.getTime() - MAX_WINDOW_MS)
    const sinceDate = desiredSince < earliestAllowed ? earliestAllowed : desiredSince

    const truncated = desiredSince < earliestAllowed
    const since = sinceDate.toISOString()
    const until = now.toISOString()
    if (truncated) {
      console.warn(
        `[cron/tipsa-refresh] cursor ${lastPoll.toISOString()} mas viejo que 24h; ventana recortada a ${since}`,
      )
    }

    // ---- 2. Deltas TIPSA ----
    const config = loadTipsaConfig()
    const deltas = await fetchTrackingDeltas(config, since, until)
    console.log(
      `[cron/tipsa-refresh] ventana ${since} -> ${until} · ${deltas.length} deltas`,
    )

    if (deltas.length === 0) {
      await saveCursor(admin, now)
      return NextResponse.json({
        ok: true,
        processed: 0,
        updated_orders: 0,
        updated_shipments: 0,
        deltas_received: 0,
        recogidas: await runPickupsPass(admin, config),
        duration_ms: Date.now() - started,
      })
    }

    // ---- 3. Albaranes que se han movido ----
    // Del delta solo nos quedamos con el albaran. El resto de campos (codigo,
    // fecha) describen la propagacion al feed, no el evento — ver la nota mas
    // abajo, en la llamada a ConsEnvEstados.
    const byAlbaran = new Set<string>(deltas.map((d) => d.albaran))

    let updatedOrders = 0
    let updatedShipments = 0
    let processed = 0
    let notFound = 0
    let failed = 0

    for (const albaran of byAlbaran) {
      const parent = await findParent(admin, albaran)
      if (!parent) {
        notFound += 1
        continue
      }

      const fkColumn = parent.table === 'orders' ? 'order_id' : 'shipment_id'

      // Pedimos el historial AUTORITATIVO del albaran. Los deltas solo sirven
      // para saber QUE albaranes se han movido, nunca como historial: la fecha
      // que trae ConsEnvEstIncCambiosEstados NO es la del evento sino la de su
      // propagacion al feed.
      //
      // Comprobado con el albaran 0000012005 (09/09/2026). Recorrido real segun
      // ConsEnvEstados y segun la web publica de TIPSA, que coinciden al minuto:
      //   0 doc 04/09 16:03 · 1 transito 04/09 18:15 · 4 incid 07/09 09:26
      //   2 reparto 08/09 08:57 · 4 incid 08/09 13:38 · 3 ENTREGADO 08/09 14:23
      // Lo que habia llegado por el feed para ese mismo envio:
      //   1 el 08/09 18:50 · 18 el 09/09 07:29 · 2 el 09/09 07:29 · 4 el 09/09 17:15
      // Fechas que no existen, y sin la entrega. El envio salia "En reparto con
      // incidencia" cuando llevaba entregado desde el dia anterior.
      //
      // Coste: 1 llamada paginada de deltas + 1 por albaran que se ha movido
      // (no por albaran vivo), que es un puñado por barrido.
      let events: Array<{ code: string; label: string; date: string; rawAttributes: Record<string, string> }>
      try {
        const tracking = await fetchTracking(config, albaran)
        events = tracking.events
      } catch (err) {
        // Fallo puntual de TIPSA (timeout, sesion caducada). No abortamos el
        // barrido entero por un albaran, pero lo contamos: mas abajo eso impide
        // avanzar el cursor, para que el siguiente tick vuelva a detectarlo.
        // Sin eso el envio se quedaria con el estado viejo para siempre, porque
        // el feed de deltas solo lo nombra mientras esta dentro de la ventana.
        failed += 1
        console.error(
          `[cron/tipsa-refresh] ConsEnvEstados ${albaran}:`,
          (err as Error).message,
        )
        continue
      }

      // El UNIQUE (order_id|shipment_id, carrier, event_code, event_date) hace
      // de dedupe: 23505 significa "ya lo teniamos".
      for (const ev of events) {
        const { error } = await admin.from('shipping_events').insert({
          [fkColumn]: parent.id,
          carrier: 'tipsa',
          event_code: ev.code,
          event_label: ev.label,
          event_date: ev.date,
          raw_payload: ev.rawAttributes,
        })
        if (error && error.code !== '23505') {
          console.error(
            `[cron/tipsa-refresh] insert event ${albaran}:`,
            error.message,
          )
        }
      }

      // Recalcular el estado oficial sobre TODOS los eventos del envio, no
      // solo los recien llegados: resolveOfficialStatus necesita ver si en
      // algun momento hubo un terminal (3 Entregado / 5 Devuelto).
      const { data: allEvents } = await admin
        .from('shipping_events')
        .select('event_code, event_date')
        .eq(fkColumn, parent.id)
        .order('event_date', { ascending: true })
        // Desempate estable: hay albaranes con dos eventos en el mismo segundo
        // (visto un 18 y un 2 a la vez). Sin orden secundario, el estado
        // oficial cambia de una pasada a otra.
        .order('id', { ascending: true })

      const official = resolveOfficialStatus(
        (allEvents ?? []) as Array<{ event_code: string; event_date: string }>,
        (e) => e.event_code,
      )
      if (!official) {
        processed += 1
        continue
      }

      const updates: Record<string, unknown> = {
        tracking_last_status: official.event_code,
        tracking_last_checked_at: now.toISOString(),
      }
      // delivered_at solo en shipments, que es donde esa columna es de TIPSA.
      // En orders la gobierna el trigger orders_auto_delivered_at (pasa a
      // 'completado') y de ahi comen las metricas de SLA: escribir aqui la
      // fecha del transportista era pisar el dato de otro dueño.
      if (parent.table === 'shipments' && isTerminalEvent(official.event_code)) {
        updates.delivered_at = official.event_date
      }

      const { error: updErr } = await admin
        .from(parent.table)
        .update(updates)
        .eq('id', parent.id)
      if (updErr) {
        console.error(
          `[cron/tipsa-refresh] update ${parent.table}:`,
          updErr.message,
        )
      } else if (parent.table === 'orders') {
        updatedOrders += 1
      } else {
        updatedShipments += 1
      }
      processed += 1
    }

    // Solo avanzamos el cursor si TODOS los albaranes se han podido consultar.
    // Si alguno fallo, dejarlo donde esta hace que el siguiente tick repita la
    // misma ventana y lo reintente; el UNIQUE de shipping_events hace que
    // reprocesar lo ya guardado no cueste nada. Si el fallo fuera permanente el
    // cursor se quedaria atras, pero el recorte a 23.5h acota la ventana y el
    // contador `albaranes_fallidos` de la respuesta lo deja a la vista.
    if (failed === 0) {
      await saveCursor(admin, now)
    } else {
      console.warn(
        `[cron/tipsa-refresh] ${failed} albaranes fallaron; no se avanza el cursor para reintentarlos`,
      )
    }

    return NextResponse.json({
      ok: true,
      processed,
      updated_orders: updatedOrders,
      updated_shipments: updatedShipments,
      deltas_received: deltas.length,
      albaranes_unicos: byAlbaran.size,
      albaranes_desconocidos: notFound,
      albaranes_fallidos: failed,
      cursor_avanzado: failed === 0,
      recogidas: await runPickupsPass(admin, config),
      duration_ms: Date.now() - started,
    })
  } catch (err) {
    const e = err as Error
    console.error('[cron/tipsa-refresh] fatal:', e.message)
    return NextResponse.json(
      { error: e.message, duration_ms: Date.now() - started },
      { status: 500 },
    )
  }
}

// Permitir GET para poder dispararlo a mano desde el navegador o curl
// sin montar un POST. Misma logica y misma auth.
export async function GET(request: NextRequest) {
  return POST(request)
}

// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Recogidas: van en el mismo tick para no montar otro pg_cron ni otro secret.
 * Son pocas al dia, asi que se consultan una a una (ConsRecEstados +
 * ConsRecogida) sin feed de deltas. Un fallo aqui no toca el cursor ni la
 * respuesta de los envios: se informa y ya.
 */
async function runPickupsPass(admin: AdminClient, config: ReturnType<typeof loadTipsaConfig>) {
  try {
    const r = await refreshTrackedPickups(admin, config)
    if (r.failed.length > 0) {
      console.warn('[cron/tipsa-refresh] recogidas fallidas:', JSON.stringify(r.failed))
    }
    return { refrescadas: r.refreshed, fallidas: r.failed.length, avisos_hsm: r.hsmRetried }
  } catch (err) {
    console.error('[cron/tipsa-refresh] recogidas:', (err as Error).message)
    return { error: (err as Error).message }
  }
}

/** Busca el albaran primero en orders y, si no aparece, en shipments. */
async function findParent(
  admin: AdminClient,
  albaran: string,
): Promise<{ table: 'orders' | 'shipments'; id: string } | null> {
  const { data: order } = await admin
    .from('orders')
    .select('id')
    .eq('tracking_number', albaran)
    .maybeSingle()
  if (order) return { table: 'orders', id: order.id as string }

  const { data: shipment } = await admin
    .from('shipments')
    .select('id')
    .eq('tracking_number', albaran)
    .maybeSingle()
  if (shipment) return { table: 'shipments', id: shipment.id as string }

  return null
}

async function saveCursor(admin: AdminClient, at: Date): Promise<void> {
  const { error } = await admin
    .from('app_settings')
    .upsert({ key: 'tipsa_last_poll_at', value: at.toISOString() })
  if (error) {
    console.error('[cron/tipsa-refresh] guardar cursor:', error.message)
  }
}
