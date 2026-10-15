'use client'

import type { Product } from '@/types/database'
import { isFreePrice } from '@/lib/product-rules'
import CatalogSelectionBar from './CatalogSelectionBar'
import ProductDetail from './ProductDetail'
import { useCatalogSelection } from './CatalogSelectionProvider'

interface ProductDetailBrowserProps {
  product: Product
  /** Catálogo completo: lo necesita la barra para resolver los `code`. */
  products: Product[]
  canCreateOrder: boolean
  related?: React.ReactNode
}

/** Límite cliente de la ficha: conecta ProductDetail con la selección. */
export default function ProductDetailBrowser({
  product,
  products,
  canCreateOrder,
  related,
}: ProductDetailBrowserProps) {
  const { qtyOf, add, inc, dec, stockOf } = useCatalogSelection()

  return (
    <>
      <ProductDetail
        product={product}
        qty={qtyOf(product.code)}
        onAdd={add}
        onInc={inc}
        onDec={dec}
        lockQty={isFreePrice(product)}
        related={related}
        stock={stockOf(product)}
      />
      <div className="section-shell">
        <CatalogSelectionBar products={products} canCreateOrder={canCreateOrder} />
      </div>
    </>
  )
}
