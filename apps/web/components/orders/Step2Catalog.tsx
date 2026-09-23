'use client'

import { useMemo, useState } from 'react'
import { Gift, Palmtree, PlusCircle } from 'lucide-react'
import type { Product, ProductRegion, PurchaseType } from '@/types/database'
import { formatEurosCents } from '@/lib/pricing'
import { isFreePrice } from '@/lib/product-rules'
import {
  IMPL_PRO_CODE,
  TABLET_GIFT_CODE,
  applyAddFreeLine,
  applyAddProduct,
  applyAddTabletGift,
  applyAdjustQty,
  applyDeclineTabletGift,
  applyRemoveLine,
  applyUpdateLine,
  findByCode,
  hasProduct,
  qtyByProduct,
  tabletGiftIndex,
  type CartLineState,
} from '@/lib/catalog/rules'
import { CATALOG_TABS, type CatalogTabKey } from '@/lib/catalog-taxonomy'
import CatalogRoot from '@/components/catalog/CatalogRoot'
import CatalogExplorer from '@/components/catalog/CatalogExplorer'
import ProductDetailModal from '@/components/catalog/ProductDetailModal'
import CartLine from './CartLine'
import CartFab from './CartFab'

/**
 * Pestañas que se ofrecen en el wizard: las 7 familias peninsulares. La de
 * Canarias se omite a propósito — la gobierna el toggle de envío.
 */
const PENINSULA_TABS: readonly CatalogTabKey[] = CATALOG_TABS
  .filter((t) => t.region === 'peninsula')
  .map((t) => t.key)

interface Step2CatalogProps {
  products: Product[]
  items: CartLineState[]
  onItemsChange: (items: CartLineState[]) => void
  /** Override de IVA para el preview de las líneas (CP canario). */
  vatRateOverride?: number | null
  purchaseType?: PurchaseType | ''
  /** Región elegida en el paso 2; prerrellena el CP del paso 3. */
  region: ProductRegion
  onRegionChange: (region: ProductRegion) => void
  /** Solo para que el total del botón flotante cuadre con CartSummary. */
  discountGlobalPct?: number
}

/**
 * Paso 2 del wizard con la estética del catálogo comercial.
 *
 * Sustituye a ProductCatalog.tsx manteniendo TODAS sus reglas — solo que
 * ahora viven en lib/catalog/rules.ts y las comparte con /catalogo:
 *   · tablet regalo al añadir Implementación Pro (y se retira con él)
 *   · línea libre para producto fuera de catálogo u oferta mixta
 *   · transferencias SaaS solo muestra software e implementación
 *
 * Lo nuevo es el toggle de región: el CP se pide en el paso 3, así que sin
 * esto el comercial podría mezclar precios peninsulares y canarios, que son
 * dos listas distintas. El servidor lo rechaza igualmente, pero descubrirlo
 * al confirmar el pedido sería el peor momento.
 */
export default function Step2Catalog({
  products,
  items,
  onItemsChange,
  vatRateOverride = null,
  purchaseType = '',
  region,
  onRegionChange,
  discountGlobalPct = 0,
}: Step2CatalogProps) {
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)
  // Marca local para no volver a preguntar por el regalo si ya dijo que no.
  const [giftDeclined, setGiftDeclined] = useState(false)

  const isSaasOnly = purchaseType === 'transferencias_saas'
  const implPro = useMemo(() => findByCode(products, IMPL_PRO_CODE), [products])
  const tablet = useMemo(() => findByCode(products, TABLET_GIFT_CODE), [products])
  const qtyMap = useMemo(() => qtyByProduct(items), [items])

  const hasImplPro = implPro !== null && hasProduct(items, implPro.id)
  /*
   * El 100 % en una tablet solo cuenta como regalo si Implementación Pro está
   * en el pedido. Sin esa condición, un AE que pusiera 100 % de descuento a una
   * tablet suelta se quedaba encerrado: la línea se auto-marcaba como regalo,
   * el input de descuento se deshabilitaba y el panel que lo explica ni se
   * renderiza sin Implementación Pro, así que no había forma de volver a 90 %
   * salvo borrar la línea.
   */
  const giftIdx = hasImplPro ? tabletGiftIndex(items, tablet) : -1
  const hasGift = giftIdx >= 0
  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  )

  /**
   * ¿Hay alguna línea que pida importe? Con envío a Canarias todos los SKU son
   * `pricing_mode = 'catalog'`, así que ninguna CartLine pinta campo de
   * precio: prometerlo en el texto describía un campo que no aparece.
   */
  const hasFreePriceLine = items.some((l) => {
    if (!l.product_id) return true
    const p = productById.get(l.product_id)
    return p ? isFreePrice(p) : true
  })

  /** Solo los SKU que admiten descripción libre pueden elegirse en una línea libre. */
  const freeLineProducts = useMemo(
    () => products.filter((p) => isFreePrice(p) && p.category === 'custom'),
    [products],
  )

  return (
    <CatalogRoot fluid>
      {isSaasOnly && (
        <div className="mb-4 rounded-lg bg-blue-50 px-4 py-2.5 text-xs text-blue-800 ring-1 ring-blue-200">
          Transferencias SaaS solo comercializa software (sin envío físico).
          Selecciona Software Qamarero y/o Implementación Pro y define el precio
          acordado con el cliente.
        </div>
      )}

      {/* Toggle de región. Oculto en transferencias SaaS: no hay envío. */}
      {!isSaasOnly && (
        <label className="mb-4 flex cursor-pointer flex-wrap items-center gap-3 rounded-xl border border-dashed border-brand/40 bg-brand/5 px-4 py-3">
          <input
            type="checkbox"
            checked={region === 'canarias'}
            onChange={(e) =>
              onRegionChange(e.target.checked ? 'canarias' : 'peninsula')
            }
            className="h-4 w-4 accent-brand"
          />
          <Palmtree size={17} className="text-brand" aria-hidden="true" />
          <span className="flex-1 min-w-[240px]">
            <span className="block text-sm font-medium text-gray-900">
              ¿El envío es a Canarias?
            </span>
            <span className="mt-0.5 block text-xs text-gray-600">
              Canarias tiene su propia lista de precios, con importes finales sin
              IVA. Al marcarlo, el catálogo pasa a mostrar solo esos productos y{' '}
              <strong className="font-semibold">se vacía el pedido</strong>: las
              dos listas no son intercambiables.
            </span>
          </span>
        </label>
      )}

      <CatalogExplorer
        products={products}
        qtyByProductId={qtyMap}
        mode="inline"
        onOpenDetail={setDetailProduct}
        purchaseType={purchaseType}
        showHeading={false}
        /*
         * La pestaña se fija por contexto:
         *   transferencias SaaS -> solo servicios (no hay envío físico)
         *   envío a Canarias    -> solo la lista canaria
         *   resto               -> el AE elige familia
         * En el wizard NO se ofrece la pestaña de Canarias: la gobierna el
         * toggle de arriba, que además vacía el carrito. Si estuvieran las
         * dos vías se podrían mezclar dos listas de precios distintas.
         */
        lockedTab={
          isSaasOnly ? 'service' : region === 'canarias' ? 'canarias' : undefined
        }
        visibleTabs={PENINSULA_TABS}
        onAdd={(p) => onItemsChange(applyAddProduct(items, p))}
        onInc={(p) => onItemsChange(applyAddProduct(items, p))}
        onDec={(p) => {
          const next = applyAdjustQty(items, p.id, -1, { implPro, tablet })
          if (implPro && p.id === implPro.id) setGiftDeclined(false)
          onItemsChange(next)
        }}
      />

      {/* Panel de tablet regalo. La regla es de cliente: en la BD la línea es
          un descuento del 100 %, indistinguible de uno manual. */}
      {!isSaasOnly && hasImplPro && tablet && (
        <div
          className={`mt-5 rounded-xl border p-4 ${
            hasGift
              ? 'border-brand/40 bg-brand/5'
              : 'border-dashed border-brand/30 bg-brand/5'
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Gift size={20} className="text-brand" aria-hidden="true" />
            <div className="min-w-[240px] flex-1">
              <h4 className="text-sm font-medium text-gray-900">
                ¿Este pedido incluye {tablet.name} como regalo?
              </h4>
              <p className="mt-0.5 text-xs text-gray-600">
                Añade una línea con 100 % de descuento (valor{' '}
                <span className="font-mono">
                  {formatEurosCents(tablet.price_cents)}
                </span>
                ). Marca «Sí» solo si el paquete acordado la incluye.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onItemsChange(applyAddTabletGift(items, tablet))
                  setGiftDeclined(false)
                }}
                disabled={hasGift}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  hasGift
                    ? 'cursor-default bg-brand text-white'
                    : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-brand hover:text-white'
                }`}
              >
                Sí, añadir
              </button>
              <button
                type="button"
                onClick={() => {
                  setGiftDeclined(true)
                  onItemsChange(applyDeclineTabletGift(items, tablet))
                }}
                disabled={!hasGift && giftDeclined}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  !hasGift && giftDeclined
                    ? 'cursor-default bg-gray-200 text-gray-700'
                    : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100'
                }`}
              >
                No, sin tablet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Línea libre. Ya no cubre SaaS + Hardware: desde que la migración
          20260825000002 lo movió a `category = 'service'` tiene tarjeta propia
          en la pestaña Servicios, y el ProductPicker de aquí solo ofrece los
          SKU `custom` (es decir, `otro`). */}
      {!isSaasOnly && (
        <div className="mt-5 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-[220px] flex-1">
              <h4 className="text-sm font-medium text-gray-900">
                Producto fuera de catálogo
              </h4>
              <p className="mt-0.5 text-xs text-gray-600">
                Para solicitudes puntuales, con descripción y precio negociados
                por el AE. Las ofertas SaaS + Hardware tienen su propia tarjeta
                en la pestaña Servicios.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onItemsChange(applyAddFreeLine(items))}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-medium text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-100"
            >
              <PlusCircle size={15} aria-hidden="true" /> Añadir línea libre
            </button>
          </div>
        </div>
      )}

      {/* Una CartLine por CADA línea del pedido.
          Al pasar al catálogo en tarjetas esto se limitó a las líneas libres,
          con el argumento de que repetir un selector deshabilitado era ruido.
          El coste fue mayor que el ruido: CartLine es el único sitio del paso 2
          con input de descuento y de precio acordado, así que dejó de haber
          forma de descontar un producto de catálogo y de tarifar los tres SKU
          de servicio (Implementación Pro, Software Qamarero, SaaS + Hardware).
          Ahora vuelven todas; el selector de producto va bloqueado en las que
          vienen de una tarjeta. */}
      {items.length > 0 && (
        <div className="mt-5 space-y-3">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Líneas del pedido
            </h4>
            <p className="mt-1 text-xs text-gray-600">
              Aquí se ajusta la cantidad y el descuento de cada línea.
              {hasFreePriceLine && (
                <>
                  {' '}
                  Las de precio acordado piden además el importe, que entra
                  prerrellenado si el producto tiene tarifa.
                </>
              )}
            </p>
          </div>
          {items.map((line, idx) => {
            const product = line.product_id
              ? productById.get(line.product_id) ?? null
              : null
            /*
             * El SKU solo se elige en las líneas libres. Si viene de una
             * tarjeta del catálogo el producto ya está decidido, y cambiarlo
             * aquí dejaría la tarjeta (con su contador) y la línea contando
             * cosas distintas. Ojo: hay que pasarle el catálogo COMPLETO, no
             * `freeLineProducts`, o CartLine no encuentra el producto y se
             * queda sin nombre ni precio.
             */
            const fromCatalog = product !== null && product.category !== 'custom'
            return (
              <CartLine
                key={idx}
                index={idx}
                line={line}
                products={fromCatalog ? products : freeLineProducts}
                canRemove
                onChange={(i, partial) =>
                  onItemsChange(applyUpdateLine(items, i, partial))
                }
                onRemove={(i) => {
                  // Quitar Implementación Pro desde aquí tiene que arrastrar
                  // la tablet regalo igual que quitarla desde la tarjeta.
                  if (implPro && line.product_id === implPro.id) {
                    setGiftDeclined(false)
                    onItemsChange(
                      applyAdjustQty(items, implPro.id, -line.qty, {
                        implPro,
                        tablet,
                      }),
                    )
                    return
                  }
                  onItemsChange(applyRemoveLine(items, i))
                }}
                vatRateOverride={vatRateOverride}
                lockProduct={fromCatalog}
                lockDiscount={idx === giftIdx}
                /*
                 * La tarjeta del catálogo ya trata los de precio libre como
                 * cantidad fija a 1 (`lockQty` de AddToOrderButton), así que
                 * aquí no puede haber un input libre: se escribía 4 y quedaban
                 * cuatro implantaciones mientras el botón seguía diciendo
                 * «Añadido». El regalo, por definición, es una unidad.
                 */
                lockQty={idx === giftIdx || (product !== null && isFreePrice(product))}
                isGift={idx === giftIdx}
              />
            )
          })}
        </div>
      )}

      {/* Botón flotante con el pedido: las tarjetas son altas y el resumen
          queda lejos del pliegue. Va por portal a <body> (ver CartFab). */}
      <CartFab
        items={items}
        products={products}
        onItemsChange={onItemsChange}
        vatRateOverride={vatRateOverride}
        discountGlobalPct={discountGlobalPct}
        implPro={implPro}
        tablet={tablet}
      />

      {detailProduct && (
        <ProductDetailModal
          product={detailProduct}
          qty={qtyMap.get(detailProduct.id) ?? 0}
          onClose={() => setDetailProduct(null)}
          onAdd={(p) => onItemsChange(applyAddProduct(items, p))}
          onInc={(p) => onItemsChange(applyAddProduct(items, p))}
          onDec={(p) =>
            onItemsChange(applyAdjustQty(items, p.id, -1, { implPro, tablet }))
          }
        />
      )}
    </CatalogRoot>
  )
}
