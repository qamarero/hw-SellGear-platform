'use client'

import type { Product } from '@/types/database'
import { isFreePrice } from '@/lib/product-rules'
import ProductCard from './ProductCard'
import { useCatalogSelection } from './CatalogSelectionProvider'

/**
 * Tarjetas de "otras opciones de la familia". Es cliente porque necesita la
 * selección para pintar el badge de cantidad y los botones.
 */
export default function RelatedProducts({ products }: { products: Product[] }) {
  const { qtyOf, add, inc, dec, stockOf } = useCatalogSelection()
  return (
    <>
      {products.map((p) => (
        <ProductCard
          key={p.id}
          product={p}
          qty={qtyOf(p.code)}
          mode="link"
          onAdd={add}
          onInc={inc}
          onDec={dec}
          lockQty={isFreePrice(p)}
          stock={stockOf(p)}
        />
      ))}
    </>
  )
}
