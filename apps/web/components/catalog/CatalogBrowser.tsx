'use client'

import type { Product } from '@/types/database'
import type { CatalogTabKey } from '@/lib/catalog-taxonomy'
import CatalogExplorer from './CatalogExplorer'
import CatalogSelectionBar from './CatalogSelectionBar'
import { useCatalogSelection } from './CatalogSelectionProvider'

interface CatalogBrowserProps {
  products: Product[]
  canCreateOrder: boolean
  lockedTab?: CatalogTabKey
  showHeading?: boolean
}

/**
 * Une el explorador con la selección de /catalogo. Existe como componente
 * aparte porque las páginas son Server Components y necesitan un límite
 * cliente donde vive el estado.
 *
 * La selección se indexa por `code` (lo que viaja en la URL al wizard), pero
 * el explorador y las tarjetas trabajan con `product_id`, así que aquí se
 * traduce entre ambos.
 */
export default function CatalogBrowser({
  products,
  canCreateOrder,
  lockedTab,
  showHeading = true,
}: CatalogBrowserProps) {
  const { picks, add, inc, dec, stockOf } = useCatalogSelection()

  const qtyByProductId = new Map<string, number>()
  for (const p of products) {
    const qty = picks.get(p.code)
    if (qty) qtyByProductId.set(p.id, qty)
  }

  return (
    <>
      <CatalogExplorer
        products={products}
        qtyByProductId={qtyByProductId}
        onAdd={add}
        onInc={inc}
        onDec={dec}
        mode="link"
        lockedTab={lockedTab}
        showHeading={showHeading}
        stockFor={stockOf}
      />
      <div className="section-shell">
        <CatalogSelectionBar products={products} canCreateOrder={canCreateOrder} />
      </div>
    </>
  )
}
