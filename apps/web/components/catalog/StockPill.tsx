import { stockBadge, type ProductStockState } from '@/lib/stock/compute'

/**
 * Lo que sustituye al botón «Añadir» cuando el producto no se puede pedir.
 * Una etiqueta y no un botón deshabilitado: un botón gris sigue pareciendo
 * algo que se pulsa. Mismo alto (44 px) para que el pie no salte.
 */
export function StockBlockedChip({ label }: { label: string }) {
  return (
    <span className="inline-flex min-h-[44px] items-center rounded-lg bg-gray-100 px-3 text-[13px] font-bold text-gray-500 ring-1 ring-gray-200">
      {label}
    </span>
  )
}

/**
 * Marco ámbar de "quedan pocas". Va en línea y no como clase: las reglas de
 * .product-card en catalog.css no tienen capa y ganan a cualquier utilidad
 * de Tailwind (docs/DESIGN_SYSTEM.md), incluido su :hover.
 */
export const LOW_STOCK_FRAME: React.CSSProperties = {
  borderColor: 'var(--amber-400)',
  boxShadow: '0 0 0 1px var(--amber-300), 0 10px 26px rgba(255, 170, 0, 0.16)',
}

interface StockPillProps {
  stock: ProductStockState | undefined
  /** `overlay` va sobre la foto de la tarjeta; `inline`, junto al precio. */
  variant?: 'overlay' | 'inline'
}

/**
 * Estado de stock de un producto. No viene del catálogo web, así que va en
 * Tailwind y no en catalog.css (docs/DESIGN_SYSTEM.md: la frontera es la
 * procedencia).
 *
 * Un admin ve el mismo aviso, pero su botón sigue activo: el título lo dice
 * para que no parezca un error. "A proveedor" va en azul: no es un problema,
 * es otra vía de servirlo, y no debe confundirse con el rojo de "Sin stock".
 */
export default function StockPill({ stock, variant = 'overlay' }: StockPillProps) {
  if (!stock) return null
  const label = stockBadge(stock)
  if (!label) return null

  const empty = stock.unknown || stock.available <= 0
  const toSupplier = stock.supplier && empty
  const tone = toSupplier
    ? 'bg-blue-600 text-white'
    : stock.unknown
      ? 'bg-gray-700 text-white'
      : empty
        ? 'bg-red-600 text-white'
        : 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
  const place =
    variant === 'overlay' ? 'absolute bottom-3 left-3 z-[1]' : 'inline-flex'
  const adminOverride = stock.bypass && empty && !toSupplier

  return (
    <span
      className={`${place} rounded px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${tone}`}
      title={
        toSupplier
          ? 'No sale de nuestro almacén: se encargará a proveedor.'
          : adminOverride
            ? 'Como admin puedes pedirlo igualmente.'
            : undefined
      }
    >
      {label}
      {adminOverride ? ' · admin' : ''}
    </span>
  )
}
