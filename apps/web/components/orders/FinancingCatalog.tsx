'use client'

import { useMemo } from 'react'
import type { Product } from '@/types/database'
import { formatEurosCents } from '@/lib/pricing'
import {
  FINANCEABLE_LABEL,
  financingBaseTotalCents,
  financingInstallments,
  isFinanceableCode,
} from '@/lib/financing'
import { applySelectFinanced, type CartLineState } from '@/lib/catalog/rules'
import CatalogRoot from '@/components/catalog/CatalogRoot'
import ProductCard from '@/components/catalog/ProductCard'
import ProductGrid from '@/components/catalog/ProductGrid'
import { productStockState, type StockView } from '@/lib/stock/compute'

interface FinancingCatalogProps {
  products: Product[]
  items: CartLineState[]
  onItemsChange: (items: CartLineState[]) => void
  vatRate: number
  /**
   * Stock (lib/stock). Elegir un producto REEMPLAZA al anterior, así que el
   * de cada tarjeta se calcula sin carrito: si no, tener Pack Pro elegido
   * restaría stock compartido a Pack Premium sin motivo.
   */
  stock?: StockView | null
}

/**
 * Catálogo de financiación: selección ÚNICA entre los productos con plan.
 *
 * Comparte ProductCard con el resto del catálogo, pero no pasa por
 * CatalogExplorer: con 4 productos, un buscador y 8 pestañas serían ruido.
 *
 * El plan de plazos se pinta en el pie con el mismo patrón visual que el
 * desglose de un pack (`.pack-price-breakdown`): lista con borde superior y
 * filas etiqueta/importe. Es literalmente la misma forma.
 */
export default function FinancingCatalog({
  products,
  items,
  onItemsChange,
  vatRate,
  stock = null,
}: FinancingCatalogProps) {
  const financeable = useMemo(
    () =>
      products
        .filter((p) => isFinanceableCode(p.code))
        .sort((a, b) => a.sort_order - b.sort_order),
    [products],
  )

  const selectedId = items.find((it) => it.product_id)?.product_id ?? null

  if (financeable.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
        No hay productos financiables en el catálogo. Revisa que {FINANCEABLE_LABEL}{' '}
        estén activos.
      </div>
    )
  }

  return (
    <CatalogRoot fluid>
      <ProductGrid>
        {financeable.map((p) => {
          const selected = selectedId === p.id
          const baseTotal = financingBaseTotalCents(p.code) ?? 0
          const installments = financingInstallments(p.code, vatRate) ?? []
          const totalGross = installments.reduce((s, i) => s + i.grossCents, 0)

          return (
            <ProductCard
              key={p.id}
              product={p}
              qty={selected ? 1 : 0}
              mode="static"
              single
              // Selección única: elegir reemplaza el carrito entero por una
              // sola línea con cantidad 1 y sin descuento, que es lo que
              // valida POST /api/orders para hardware_financiacion.
              onAdd={() => onItemsChange(applySelectFinanced(p))}
              onInc={() => {}}
              onDec={() => onItemsChange([])}
              stock={stock ? productStockState(p, [], stock) : undefined}
              footerExtra={
                <div className="pack-comparison" style={{ marginTop: 16 }}>
                  <span>Total a financiar</span>
                  <strong>{formatEurosCents(totalGross)}</strong>
                  <ul className="pack-price-breakdown">
                    <li>
                      <span>
                        Base {vatRate > 0 ? `+ IVA ${vatRate} %` : '· Exento (Canarias)'}
                      </span>
                      <b>{formatEurosCents(baseTotal)}</b>
                    </li>
                    {installments.map((inst) => (
                      <li key={inst.stage}>
                        <span>
                          {inst.stage === 1
                            ? '1.er pago (entrada)'
                            : `${inst.stage}.º pago`}
                        </span>
                        <b>{formatEurosCents(inst.grossCents)}</b>
                      </li>
                    ))}
                  </ul>
                </div>
              }
            />
          )
        })}
      </ProductGrid>
      <p className="commercial-note">
        Financiar tiene un sobrecoste sobre el precio de contado: el total del
        plan reemplaza al precio de catálogo. Un pedido financiado admite un
        único producto, cantidad 1 y sin descuentos.
      </p>
    </CatalogRoot>
  )
}
