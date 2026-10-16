// =============================================================
// Tipos TypeScript generados del schema Supabase
// Actualizar con: npx supabase gen types typescript --project-id <ref>
// =============================================================

export type OrderStatus =
  | 'nuevo'
  | 'pendiente'
  | 'enviado_proveedor'
  | 'enviado'
  | 'pagado'
  | 'falta_informacion'
  | 'bloqueado'
  | 'completado'

export type PurchaseType =
  | 'kit_digital'
  | 'hardware_one_off'
  | 'hardware_financiacion'
  | 'transferencias_saas'
  | 'saas_hardware'
  | 'otro'

export type UserRole = 'viewer' | 'commercial' | 'hardware' | 'manager' | 'admin'

export type ProductCategory =
  | 'pack'
  | 'tpv'
  | 'kds'
  | 'printer'
  | 'accessory'
  | 'network'
  /** Servicios y SaaS: Implementación Pro, Software Qamarero, SaaS + Hardware. */
  | 'service'
  /** Solo `otro`. Sin pestaña en el catálogo: es el mecanismo de línea libre. */
  | 'custom'
  /**
   * @deprecated Migrado a 'service' en 20260825000002. Se conserva un release
   * porque el SQL se aplica a mano (CLAUDE.md) y hay una ventana en la que la
   * BD puede tener el valor viejo mientras el build ya lleva el nuevo.
   * Al quitarlo, TypeScript señalará los sitios que queden por limpiar.
   */
  | 'saas_hardware'

/**
 * Eje ORTOGONAL a `category`. Los SKU canarios llevan precio FINAL y
 * vat_rate = 0: no es una exención sobre el precio peninsular, es otra lista
 * de precios (TPV Pro 627 € + IVA en península, 539,07 € finales en Canarias).
 * Un TPV canario sigue siendo category = 'tpv'.
 */
export type ProductRegion = 'peninsula' | 'canarias'

/**
 * Cómo se fija el precio de una línea con este producto.
 *   catalog          — precio de catálogo (`price_cents`).
 *   free_price       — el AE introduce el precio; el nombre es fijo.
 *   free_price_named — el AE introduce precio Y descripción.
 * Sustituye al predicado que estaba replicado por `code` en 7 ficheros.
 */
export type ProductPricingMode = 'catalog' | 'free_price' | 'free_price_named'

/** Entrada de `products.specifications`: array para preservar el orden curado. */
export interface ProductSpec {
  label: string
  value: string
}

/** Entrada de `products.price_breakdown`. Importes en CÉNTIMOS. */
export interface ProductPriceBreakdownItem {
  label: string
  price_cents: number
  quantity?: number
}

/** Entrada de `products.model_options`: modelos que se envían según stock. */
export interface ProductModelOption {
  name: string
  image_url: string
}

export interface Product {
  id: string
  code: string
  name: string
  /** Descripción técnica/ops para hardware. El texto comercial es `summary`. */
  description: string | null
  category: ProductCategory
  price_cents: number
  vat_rate: number
  /** Bultos estimados para TIPSA. No es lo mismo que `components.length`. */
  package_count: number
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string

  // ── Ficha comercial (20260825000001). Nullable: el SQL se aplica a mano,
  // así que el código tiene que tolerar filas aún sin metadatos.
  /** `id` en hw-qamarero-catalog/lib/catalog.ts. Solo linaje de importación. */
  catalog_slug?: string | null
  brand?: string | null
  model?: string | null
  /** One-liner comercial. Las tarjetas y la ficha lo prefieren a `description`. */
  summary?: string | null
  ideal_for?: string | null
  badge?: string | null
  /** Nota INTERNA para el comercial. NUNCA en comunicación al cliente. */
  internal_note?: string | null
  availability_note?: string | null
  model_availability_note?: string | null
  price_prefix?: string | null
  /** Ruta bajo /products/. Reemplaza la derivación por `code` del cliente. */
  image_url?: string | null

  // ── Ejes de negocio
  region?: ProductRegion
  pricing_mode?: ProductPricingMode
  /** FALSE ⇒ la línea no admite `discount_pct` distinto de 0. */
  allows_discount?: boolean
  /**
   * TRUE ⇒ sin stock suficiente se pide a proveedor: nunca se bloquea por
   * stock (20261016000001). Ver lib/stock/compute.ts.
   */
  supplier_fallback?: boolean

  // ── Listas y estructuras ordenadas
  highlights?: string[]
  components?: string[]
  specifications?: ProductSpec[]
  price_breakdown?: ProductPriceBreakdownItem[] | null
  model_options?: ProductModelOption[] | null
  /** Suma de `price_breakdown`. Lo mantiene un trigger. */
  standalone_price_cents?: number | null
}

export interface UserProfile {
  id: string
  full_name: string | null
  email: string | null
  role: UserRole
  department: string | null
  /** Slack member ID (formato U…) para menciones en avisos. Manual. */
  slack_user_id: string | null
  created_at: string
  updated_at: string
}

export interface Order {
  id: string
  operation_id: string
  created_at: string
  updated_at: string
  created_by: string | null
  source: string
  source_department: string | null
  customer_name: string
  venue_name: string | null
  contact_email: string | null
  phone: string | null
  purchase_type: PurchaseType | null
  amount: number | null
  /** Descuento global (%) aplicado a la base imponible del pedido, adicional
   *  a los descuentos por línea de order_items.discount_pct. Rango 0-100.
   *  Se prorratea proporcionalmente entre las bases de cada línea antes de
   *  calcular el IVA (fiscalmente correcto con IVA mixto Península/Canarias). */
  discount_global_pct: number | null
  /** Ajuste manual (céntimos) que se RESTA al total c/IVA. Solo admin.
   *  No recalcula IVA. Requiere motivo cuando > 0. */
  manual_adjustment_cents: number | null
  manual_adjustment_reason: string | null
  bank_receipt_url: string | null
  requester_name: string | null
  requester_email: string | null
  ae_ref: string | null
  hubspot_ref: string | null
  invoice_ref: string | null
  shipping_address: string | null
  status: OrderStatus
  assigned_to: string | null
  notes: string | null
  typeform_response_id: string | null
  supplier: string | null
  invoiced: boolean
  prepared: boolean
  shipped: boolean
  shipping_label_url: string | null
  tracking_number: string | null
  delivered_at: string | null
  // TIPSA integration (tras aplicar migracion 20260421000001_add_tipsa_fields)
  carrier: string | null
  carrier_service_code: string | null
  carrier_guid: string | null
  shipping_weight_kg: number | null
  shipping_packages: number | null
  shipping_content: string | null
  shipping_observations: string | null
  shipped_at: string | null
  tracking_public_url: string | null
  tracking_last_status: string | null
  tracking_last_checked_at: string | null
  // Direccion estructurada (tras aplicar migracion 20260424000001_structured_shipping_fields)
  shipping_street: string | null
  shipping_cp: string | null
  shipping_city: string | null
  shipping_province: string | null
  // TIPSA envio con retorno (tras aplicar migracion 20260423000001_shipping_return)
  shipping_return: boolean | null
  // TIPSA entrega en sabado (tras aplicar migracion 20260505000005_add_saturday_delivery)
  shipping_saturday: boolean
  // joins
  order_items?: OrderItem[]
  creator?: UserProfile
  assignee?: UserProfile
  shipping_events?: ShippingEvent[]
  order_payments?: OrderPayment[]
}

export type PaymentStatus = 'pendiente' | 'pagado'

export interface OrderPayment {
  id: string
  order_id: string
  /** 1 = entrada, 2 y 3 = plazos restantes. */
  installment_no: 1 | 2 | 3
  /** Importe base s/IVA del plazo (céntimos). */
  amount_base_cents: number
  vat_rate: number
  /** Importe gross (base + IVA) que transfiere el cliente. */
  amount_cents: number
  status: PaymentStatus
  paid_at: string | null
  receipt_url: string | null
  created_at: string
  updated_at: string
}

export interface ShippingEvent {
  id: number
  /** XOR con shipment_id: exactamente uno de los dos viene rellenado. */
  order_id: string | null
  shipment_id: string | null
  carrier: string
  event_code: string
  event_label: string | null
  event_date: string
  raw_payload: Record<string, unknown> | null
  created_at: string
}

export type ShipmentStatus =
  | 'pendiente'
  | 'en_curso'
  | 'entregado'
  | 'incidencia'
  | 'devuelto'
  | 'cancelado'

export interface Shipment {
  id: string
  shipment_id: string
  status: ShipmentStatus
  created_at: string
  updated_at: string
  created_by: string | null
  // Sender libre (no env vars)
  sender_name: string
  sender_address: string
  sender_cp: string
  sender_city: string
  sender_phone: string | null
  // Recipient
  recipient_name: string
  recipient_address: string
  recipient_cp: string
  recipient_city: string
  recipient_phone: string | null
  recipient_email: string | null
  recipient_contact_person: string | null
  // Detalles envio
  service_code: string
  packages: number
  weight_kg: number
  content: string | null
  observations: string | null
  return_shipment: boolean
  saturday_delivery: boolean
  reference: string | null
  // TIPSA
  albaran: string | null
  tracking_number: string | null
  tracking_public_url: string | null
  carrier_guid: string | null
  tracking_last_status: string | null
  tracking_last_checked_at: string | null
  shipped_at: string | null
  delivered_at: string | null
  shipping_label_url: string | null
  notes: string | null
  // joins (opcional)
  shipping_events?: ShippingEvent[]
  creator?: UserProfile
}

export interface ShipmentSenderInput {
  name: string
  address: string
  cp: string
  city: string
  phone?: string | null
}

export interface ShipmentRecipientInput {
  name: string
  address: string
  cp: string
  city: string
  phone?: string | null
  email?: string | null
  contact_person?: string | null
}

export interface ShipmentCreateInput {
  sender: ShipmentSenderInput
  recipient: ShipmentRecipientInput
  service_code: string
  packages?: number
  weight_kg?: number
  content?: string | null
  observations?: string | null
  return_shipment?: boolean
  saturday_delivery?: boolean
  reference?: string | null
  notes?: string | null
}

export interface OrderItem {
  id: string
  order_id: string
  product_name: string | null
  qty: number
  unit_price: number | null
  notes: string | null
  created_at: string
  product_id: string | null
  unit_price_cents: number | null
  discount_pct: number | null
  vat_rate: number | null
  /** Unidades que van a proveedor por falta de stock (20261016000001). */
  supplier_qty?: number
  product?: Product | null
}

export interface StatusHistory {
  id: string
  order_id: string
  from_status: OrderStatus | null
  to_status: OrderStatus
  changed_by: string | null
  changed_at: string
  comment: string | null
  changer?: UserProfile
}

export interface Comment {
  id: string
  order_id: string
  author_id: string | null
  body: string
  created_at: string
  updated_at: string
  author?: UserProfile
}

export interface OrderStatusLabel {
  status: OrderStatus
  label_es: string
  color: string
  description: string
}

export interface AddressBookEntry {
  id: string
  created_at: string
  updated_at: string
  created_by: string | null
  alias: string | null
  name: string
  venue_name: string | null
  address: string
  cp: string
  city: string
  province: string | null
  phone: string | null
  email: string | null
  contact_person: string | null
  notes: string | null
  // search_text es columna generada, no se expone al cliente.
}

export type AddressBookInput = Omit<
  AddressBookEntry,
  'id' | 'created_at' | 'updated_at' | 'created_by'
>
