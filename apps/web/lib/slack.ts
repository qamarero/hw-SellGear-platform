// =============================================================
// Slack notifications — server-side only.
//
// Postea al Incoming Webhook del canal de Hardware (SLACK_WEBHOOK_URL,
// Vercel env). Compone menciones (@aquí + creador/solicitante + categoría)
// y mensajes Blocks. NUNCA lanza: un fallo de Slack no rompe la operación
// del pedido. No-op silencioso si SLACK_WEBHOOK_URL no está (con warn).
//
// Eventos soportados:
//   - new_order
//   - status_change (filtrado: solo SLACK_NOTIFY_STATUSES)
//   - message_to_hardware
//   - financing_payment
//
// Formato (todos los eventos):
//   1. Header section: mentions + título con link al pedido
//   2. Divider
//   3. Fields section: 2 columnas con datos clave (cliente, local, ...)
//   4. Section opcional: resumen de productos / mensaje / comentario libre
//   5. Actions: [Ver pedido] [+Ver en HubSpot si hubspot_ref]
//   6. Context footer: tipo + importe (o creador en new_order)
// =============================================================

import { PURCHASE_TYPE_LABELS } from '@/lib/utils'
import type { PurchaseType } from '@/types/database'

const STATUS_LABELS: Record<string, string> = {
  nuevo: 'Nuevo',
  pendiente: 'Pendiente',
  enviado_proveedor: 'Enviado desde proveedor',
  enviado: 'Enviado',
  pagado: 'Pagado',
  falta_informacion: 'Falta información',
  bloqueado: 'Bloqueado',
  completado: 'Completado',
}

/** Icono por estado destino (para el título del status_change). */
const STATUS_ICONS: Record<string, string> = {
  nuevo: ':sparkles:',
  pendiente: ':hourglass_flowing_sand:',
  enviado_proveedor: ':outbox_tray:',
  enviado: ':truck:',
  pagado: ':moneybag:',
  falta_informacion: ':warning:',
  bloqueado: ':no_entry:',
  completado: ':white_check_mark:',
}

/** Estados que generan aviso a Slack. Resto = silencio (sin ruido). */
export const SLACK_NOTIFY_STATUSES: ReadonlySet<string> = new Set([
  'enviado_proveedor',
  'enviado',
  'pagado',
  'falta_informacion',
  'bloqueado',
  'completado',
])

export type SlackNotifyEvent =
  | 'new_order'
  | 'status_change'
  | 'message_to_hardware'
  | 'financing_payment'

interface OrderContext {
  order_id: string
  operation_id: string
  customer_name: string
  venue_name?: string | null
  requester_name?: string | null
  purchase_type?: PurchaseType | null
  /** Importe total del pedido en céntimos (orders.amount * 100). */
  amount_cents?: number | null
}

export interface NewOrderCtx extends OrderContext {
  event: 'new_order'
  /** Slack ID del solicitante (mención adicional al canal). El call-site lo
   *  resuelve buscando user_profiles.email = orders.requester_email. */
  requester_slack_user_id?: string | null
  /** Resumen ya formateado de líneas del pedido, ej. "2× Pack Pro · 1× TPV". */
  items_summary?: string | null
  /** Ciudad y CP de envío. Si null/empty, no se muestra (SaaS/financiación). */
  shipping_city?: string | null
  shipping_cp?: string | null
  /** URL completa del deal en HubSpot. Si presente, segundo botón en el msg. */
  hubspot_ref?: string | null
  /** Nombre completo del creador del pedido, para el footer. */
  creator_name?: string | null
  /** Comentario libre desde el botón manual "Enviar a Slack". */
  comment?: string | null
}

export interface StatusChangeCtx extends OrderContext {
  event: 'status_change'
  from_status: string | null
  to_status: string
  changed_by?: string | null
  comment?: string | null
  /** Slack user ID del creador (mención en falta_informacion). */
  creator_slack_user_id?: string | null
}

export interface MessageToHardwareCtx extends OrderContext {
  event: 'message_to_hardware'
  author_name: string
  author_role?: string | null
  message: string
}

export interface FinancingPaymentCtx extends OrderContext {
  event: 'financing_payment'
  installment_no: 1 | 2 | 3
  /** Importe del plazo en céntimos (importe del pago concreto). */
  installment_amount_cents: number
  // El total del pedido (suma de los 3 plazos) viene en `amount_cents`
  // heredado de OrderContext.
}

export type NotifyCtx =
  | NewOrderCtx
  | StatusChangeCtx
  | MessageToHardwareCtx
  | FinancingPaymentCtx

// =============================================================
// Helpers de formato (puros)
// =============================================================

/** "1.234,56 €" — formato es-ES desde céntimos. Vacío si null/undefined. */
function formatEur(cents: number | null | undefined): string {
  if (cents == null) return ''
  return (cents / 100).toLocaleString('es-ES', {
    style: 'currency',
    currency: 'EUR',
  })
}

/**
 * "2× Pack Pro · 1× TPV · 1× KDS" — toma las primeras maxLines líneas y
 * resume el resto como "+N más". Vacío si no hay items.
 */
export function formatItemsSummary(
  items: ReadonlyArray<{ product_name: string; qty: number }>,
  maxLines = 3,
): string {
  if (items.length === 0) return ''
  const head = items.slice(0, maxLines).map((i) => `${i.qty}× ${i.product_name}`)
  const rest = items.length - maxLines
  if (rest > 0) head.push(`+${rest} más`)
  return head.join(' · ')
}

/**
 * Añade al resumen de productos qué va a proveedor por falta de stock
 * ("Pack Premium ×1"), para que quien prepara el pedido lo vea en el mismo
 * aviso. Sin nada a proveedor devuelve el resumen tal cual.
 */
export function withSupplierWarning(
  summary: string,
  toSupplier: readonly string[],
): string {
  if (toSupplier.length === 0) return summary
  const warning = `:warning: *A pedir a proveedor (sin stock):* ${toSupplier.join(' · ')}`
  return summary ? `${summary}\n${warning}` : warning
}

// =============================================================
// Menciones
// =============================================================

/**
 * "<!here> <@U1> <@U2>" — filtra vacíos, deduplica. Cadena vacía si nada.
 */
export function formatMentions(
  ids: ReadonlyArray<string | null | undefined>,
  opts: { here?: boolean } = {},
): string {
  const seen = new Set<string>()
  const parts: string[] = []
  if (opts.here) parts.push('<!here>')
  for (const id of ids) {
    if (!id) continue
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    parts.push(`<@${trimmed}>`)
  }
  return parts.join(' ')
}

/**
 * Lee SLACK_CATEGORY_MENTIONS (env JSON) y devuelve los Slack IDs fijos
 * para una purchase_type. Fallback a "default" si el tipo no tiene match.
 * Devuelve [] si la JSON es inválida o el env no existe.
 */
export function resolveCategoryMentions(
  purchaseType: PurchaseType | null | undefined,
): string[] {
  const raw = process.env.SLACK_CATEGORY_MENTIONS
  if (!raw) return []
  let map: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    map = parsed as Record<string, unknown>
  } catch {
    console.error('SLACK_CATEGORY_MENTIONS: JSON inválido, ignorando.')
    return []
  }
  const key = purchaseType ?? 'default'
  const fromKey = map[key]
  const fromDefault = map['default']
  const pick: unknown[] = Array.isArray(fromKey)
    ? fromKey
    : Array.isArray(fromDefault)
      ? fromDefault
      : []
  return pick.filter(
    (s): s is string => typeof s === 'string' && s.trim().length > 0,
  )
}

/**
 * Mención al user group de Hardware (formato `<!subteam^ID>`) leído desde
 * SLACK_HARDWARE_USERGROUP_ID. Devuelve cadena vacía si la env no está.
 * Slack renderiza el handle automáticamente (ej. `@hardware_cx`) y pinguea
 * solo a los miembros del grupo, no a todo el canal.
 */
function resolveTeamMention(): string {
  const id = process.env.SLACK_HARDWARE_USERGROUP_ID?.trim()
  return id ? `<!subteam^${id}>` : ''
}

/** Menciones por evento (subteam Hardware + solicitante / creador / categoría
 *  — sin @aquí para evitar ruido en el canal). */
function resolveMentionsForEvent(ctx: NotifyCtx): string {
  const categoryIds = resolveCategoryMentions(ctx.purchase_type)
  switch (ctx.event) {
    case 'new_order': {
      // Subteam Hardware + solicitante (si tiene slack_user_id) + categoría.
      const team = resolveTeamMention()
      const personal = formatMentions([ctx.requester_slack_user_id, ...categoryIds])
      return [team, personal].filter(Boolean).join(' ')
    }
    case 'message_to_hardware': {
      // Subteam Hardware + personas fijas por categoría.
      const team = resolveTeamMention()
      const personal = formatMentions(categoryIds)
      return [team, personal].filter(Boolean).join(' ')
    }
    case 'status_change':
      if (ctx.to_status === 'falta_informacion') {
        // Ping al creador para que complete; categoría también si configurada.
        return formatMentions([ctx.creator_slack_user_id, ...categoryIds])
      }
      // Resto de estados clave: solo canal, sin ping (bajo ruido).
      return ''
    case 'financing_payment':
      return formatMentions(categoryIds)
  }
}

// =============================================================
// Block Kit helpers (privados)
// =============================================================

type Block = Record<string, unknown>

const dividerBlock = (): Block => ({ type: 'divider' })

const contextBlock = (text: string): Block => ({
  type: 'context',
  elements: [{ type: 'mrkdwn', text }],
})

/** Field individual para usar dentro de section.fields (layout 2 columnas). */
const fieldPair = (label: string, value: string): { type: 'mrkdwn'; text: string } => ({
  type: 'mrkdwn',
  text: `*${label}:*\n${value}`,
})

const sectionMrkdwn = (text: string): Block => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
})

const sectionFields = (fields: { type: 'mrkdwn'; text: string }[]): Block => ({
  type: 'section',
  fields,
})

interface ButtonSpec {
  text: string
  url: string
  primary?: boolean
}

const actionsBlock = (buttons: ButtonSpec[]): Block => ({
  type: 'actions',
  elements: buttons.map((b) => ({
    type: 'button',
    text: { type: 'plain_text', text: b.text, emoji: true },
    url: b.url,
    ...(b.primary ? { style: 'primary' } : {}),
  })),
})

/** Etiqueta legible de purchase_type, o "Tipo n/a" si no aplica. */
function purchaseTypeLabel(pt: PurchaseType | null | undefined): string {
  if (!pt) return 'Tipo n/a'
  return PURCHASE_TYPE_LABELS[pt] ?? pt
}

// =============================================================
// Render del mensaje (Blocks) — puro, sin red ni env
// =============================================================

export interface SlackMessage {
  text: string
  blocks: Block[]
}

/**
 * Compone text + Blocks para Slack. PURO (sin red ni env). El caller
 * pasa las menciones ya resueltas y el appUrl. Testable con vitest.
 */
export function buildSlackMessage(
  ctx: NotifyCtx,
  mentionsPrefix: string,
  appUrl: string,
): SlackMessage {
  const orderUrl = `${appUrl}/orders/${ctx.order_id}`
  const link = `<${orderUrl}|${ctx.operation_id}>`
  const prefix = mentionsPrefix ? `${mentionsPrefix}\n\n` : ''

  switch (ctx.event) {
    case 'new_order':
      return renderNewOrder(ctx, prefix, link, orderUrl)
    case 'status_change':
      return renderStatusChange(ctx, prefix, link, orderUrl)
    case 'message_to_hardware':
      return renderMessageToHardware(ctx, prefix, link, orderUrl)
    case 'financing_payment':
      return renderFinancingPayment(ctx, prefix, link, orderUrl)
  }
}

function renderNewOrder(
  ctx: NewOrderCtx,
  prefix: string,
  link: string,
  orderUrl: string,
): SlackMessage {
  const blocks: Block[] = []
  // 1. Header
  blocks.push(sectionMrkdwn(`${prefix}*:inbox_tray: Nuevo pedido ${link}*`))
  // 2. Divider
  blocks.push(dividerBlock())
  // 3. Fields 2-col
  const fields = [
    fieldPair('Cliente', ctx.customer_name),
    fieldPair('Local', ctx.venue_name || '—'),
    fieldPair('Solicitante', ctx.requester_name || '—'),
    fieldPair('Tipo', purchaseTypeLabel(ctx.purchase_type)),
  ]
  if (ctx.amount_cents != null) {
    fields.push(fieldPair('Importe', formatEur(ctx.amount_cents)))
  }
  if (ctx.shipping_city) {
    const shipping = ctx.shipping_cp
      ? `${ctx.shipping_city} (${ctx.shipping_cp})`
      : ctx.shipping_city
    fields.push(fieldPair('Envío', shipping))
  }
  blocks.push(sectionFields(fields))
  // 4. Productos (opcional)
  if (ctx.items_summary) {
    blocks.push(sectionMrkdwn(`*Productos:* ${ctx.items_summary}`))
  }
  // 5. Comentario libre (opcional)
  if (ctx.comment) {
    const quoted = ctx.comment.replace(/\n/g, '\n> ')
    blocks.push(sectionMrkdwn(`*Comentario:*\n> ${quoted}`))
  }
  // 6. Actions
  const buttons: ButtonSpec[] = [{ text: 'Ver pedido', url: orderUrl, primary: true }]
  if (ctx.hubspot_ref) {
    buttons.push({ text: 'Ver en HubSpot', url: ctx.hubspot_ref })
  }
  blocks.push(actionsBlock(buttons))
  // 7. Context footer
  const footer = ctx.creator_name
    ? `:bust_in_silhouette: Creado por ${ctx.creator_name}`
    : `:label: ${purchaseTypeLabel(ctx.purchase_type)}`
  blocks.push(contextBlock(footer))

  return {
    text: `Nuevo pedido ${ctx.operation_id}`,
    blocks,
  }
}

function renderStatusChange(
  ctx: StatusChangeCtx,
  prefix: string,
  link: string,
  orderUrl: string,
): SlackMessage {
  const fromLabel = ctx.from_status
    ? STATUS_LABELS[ctx.from_status] ?? ctx.from_status
    : '—'
  const toLabel = STATUS_LABELS[ctx.to_status] ?? ctx.to_status
  const icon = STATUS_ICONS[ctx.to_status] ?? ':arrows_counterclockwise:'

  const blocks: Block[] = []
  // 1. Header con icono según estado destino
  blocks.push(
    sectionMrkdwn(`${prefix}*${icon} ${link} · ${fromLabel} → ${toLabel}*`),
  )
  // 2. Divider
  blocks.push(dividerBlock())
  // 3. Fields 2-col (datos esenciales del pedido)
  const fields = [
    fieldPair('Cliente', ctx.customer_name),
    fieldPair('Local', ctx.venue_name || '—'),
    fieldPair('Solicitante', ctx.requester_name || '—'),
    fieldPair('Por', ctx.changed_by || '—'),
  ]
  blocks.push(sectionFields(fields))
  // 4. Comentario del cambio (opcional)
  if (ctx.comment) {
    const quoted = ctx.comment.replace(/\n/g, '\n> ')
    blocks.push(sectionMrkdwn(`> ${quoted}`))
  }
  // 5. Actions
  blocks.push(actionsBlock([{ text: 'Ver pedido', url: orderUrl }]))
  // 6. Context footer: Tipo · Importe
  const footerParts: string[] = [`:label: ${purchaseTypeLabel(ctx.purchase_type)}`]
  if (ctx.amount_cents != null) {
    footerParts.push(`:moneybag: ${formatEur(ctx.amount_cents)}`)
  }
  blocks.push(contextBlock(footerParts.join('  ·  ')))

  return {
    text: `${ctx.operation_id} → ${toLabel}`,
    blocks,
  }
}

function renderMessageToHardware(
  ctx: MessageToHardwareCtx,
  prefix: string,
  link: string,
  orderUrl: string,
): SlackMessage {
  const author = ctx.author_role
    ? `${ctx.author_name} (${ctx.author_role})`
    : ctx.author_name
  const quoted = ctx.message.replace(/\n/g, '\n> ')

  const blocks: Block[] = []
  // 1. Header
  blocks.push(
    sectionMrkdwn(`${prefix}*:speech_balloon: Mensaje para Hardware · ${link}*`),
  )
  // 2. Divider
  blocks.push(dividerBlock())
  // 3. Fields 2-col (cliente/local + autor)
  blocks.push(
    sectionFields([
      fieldPair('Cliente', ctx.customer_name),
      fieldPair('Local', ctx.venue_name || '—'),
      fieldPair('De', author),
    ]),
  )
  // 4. Mensaje quoted
  blocks.push(sectionMrkdwn(`> ${quoted}`))
  // 5. Actions
  blocks.push(
    actionsBlock([{ text: 'Ver pedido', url: orderUrl, primary: true }]),
  )
  // 6. Context footer
  const footerParts: string[] = [`:label: ${purchaseTypeLabel(ctx.purchase_type)}`]
  if (ctx.amount_cents != null) {
    footerParts.push(`:moneybag: ${formatEur(ctx.amount_cents)}`)
  }
  blocks.push(contextBlock(footerParts.join('  ·  ')))

  return {
    text: `Mensaje para Hardware (${ctx.operation_id})`,
    blocks,
  }
}

function renderFinancingPayment(
  ctx: FinancingPaymentCtx,
  prefix: string,
  link: string,
  orderUrl: string,
): SlackMessage {
  const stageLabel =
    ctx.installment_no === 1
      ? 'Entrada (1.º)'
      : `${ctx.installment_no}.º plazo`
  const importe = formatEur(ctx.installment_amount_cents)

  const blocks: Block[] = []
  // 1. Header
  blocks.push(
    sectionMrkdwn(`${prefix}*:moneybag: Pago de financiación · ${link}*`),
  )
  // 2. Divider
  blocks.push(dividerBlock())
  // 3. Fields 2-col
  blocks.push(
    sectionFields([
      fieldPair('Cliente', ctx.customer_name),
      fieldPair('Local', ctx.venue_name || '—'),
      fieldPair('Plazo', stageLabel),
      fieldPair('Importe del plazo', importe),
    ]),
  )
  // 4. Actions
  blocks.push(actionsBlock([{ text: 'Ver pedido', url: orderUrl }]))
  // 5. Context footer: importe global del pedido si disponible
  const footerParts: string[] = [':label: Financiación']
  if (ctx.amount_cents != null) {
    footerParts.push(`:moneybag: Total pedido ${formatEur(ctx.amount_cents)}`)
  }
  blocks.push(contextBlock(footerParts.join('  ·  ')))

  return {
    text: `Pago financiación ${ctx.operation_id} (plazo ${ctx.installment_no})`,
    blocks,
  }
}

// =============================================================
// Envío
// =============================================================

export interface SlackResult {
  ok: boolean
  skipped?: boolean
  error?: string
}

/**
 * Postea al webhook. No-op silencioso (con warn) si SLACK_WEBHOOK_URL no está.
 * Nunca lanza: devuelve { ok, error? }.
 */
export async function postToSlack(message: SlackMessage): Promise<SlackResult> {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) {
    console.warn('[slack] SLACK_WEBHOOK_URL no configurado; mensaje omitido.')
    return { ok: true, skipped: true }
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      const error = detail || `HTTP ${res.status}`
      console.error('[slack] post falló:', error)
      return { ok: false, error }
    }
    return { ok: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error('[slack] post falló:', error)
    return { ok: false, error }
  }
}

/**
 * API de alto nivel: arma menciones según el evento, construye el mensaje
 * y postea. NUNCA lanza. Filtra status_change que no estén en
 * SLACK_NOTIFY_STATUSES (sin aviso → menos ruido en el canal).
 */
export async function notifyOrderEvent(ctx: NotifyCtx): Promise<SlackResult> {
  if (
    ctx.event === 'status_change' &&
    !SLACK_NOTIFY_STATUSES.has(ctx.to_status)
  ) {
    return { ok: true, skipped: true }
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-app.vercel.app'
  const mentions = resolveMentionsForEvent(ctx)
  const message = buildSlackMessage(ctx, mentions, appUrl)
  return postToSlack(message)
}
