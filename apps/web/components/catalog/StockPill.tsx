import { stockBadge, type ProductStockState } from '@/lib/stock/compute'

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
 * para que no parezca un error.
 */
export default function StockPill({ stock, variant = 'overlay' }: StockPillProps) {
  if (!stock) return null
  const label = stockBadge(stock)
  if (!label) return null

  const empty = stock.unknown || stock.available <= 0
  const tone = stock.unknown
    ? 'bg-gray-700 text-white'
    : empty
      ? 'bg-red-600 text-white'
      : 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
  const place =
    variant === 'overlay' ? 'absolute bottom-3 left-3 z-[1]' : 'inline-flex'

  return (
    <span
      className={`${place} rounded px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${tone}`}
      title={
        stock.bypass && empty
          ? 'Como admin puedes pedirlo igualmente.'
          : undefined
      }
    >
      {label}
      {stock.bypass && empty ? ' · admin' : ''}
    </span>
  )
}
