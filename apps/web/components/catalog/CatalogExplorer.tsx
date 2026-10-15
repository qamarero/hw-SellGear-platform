'use client'

import { useDeferredValue, useMemo, useState } from 'react'
import type { Product } from '@/types/database'
import type { PurchaseType } from '@/types/database'
import {
  CATALOG_TABS,
  catalogTab,
  type CatalogTabKey,
} from '@/lib/catalog-taxonomy'
import { normalizeSearch } from '@/lib/catalog/format'
import {
  isCatalogVisible,
  isFreePrice,
  referencePriceCents,
} from '@/lib/product-rules'
import CategoryGuides from './CategoryGuides'
import CatalogResultsMeta from './CatalogResultsMeta'
import CatalogToolbar, { type CatalogSort } from './CatalogToolbar'
import EmptyResults from './EmptyResults'
import ProductCard from './ProductCard'
import ProductGrid from './ProductGrid'
import type { ProductStockState } from '@/lib/stock/compute'

interface CatalogExplorerProps {
  products: Product[]
  /** Unidades en el pedido por product_id. */
  qtyByProductId: Map<string, number>
  onAdd: (product: Product) => void
  onInc: (product: Product) => void
  onDec: (product: Product) => void
  /** 'link' en /catalogo, 'inline' en el wizard (ficha en modal). */
  mode?: 'link' | 'inline'
  onOpenDetail?: (product: Product) => void
  /** Filtra el catálogo por tipo de compra (transferencias SaaS). */
  purchaseType?: PurchaseType | ''
  /** Restringe las pestañas visibles. */
  visibleTabs?: readonly CatalogTabKey[]
  /** Fija la pestaña y oculta el selector. */
  lockedTab?: CatalogTabKey
  /** El wizard ya tiene su propio <h2>; evita duplicar el nivel. */
  showHeading?: boolean
  /** Stock de cada tarjeta, contando el carrito actual (lib/stock). */
  stockFor?: (product: Product) => ProductStockState | undefined
}

export default function CatalogExplorer({
  products,
  qtyByProductId,
  onAdd,
  onInc,
  onDec,
  mode = 'link',
  onOpenDetail,
  purchaseType = '',
  visibleTabs,
  lockedTab,
  showHeading = true,
  stockFor,
}: CatalogExplorerProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<CatalogSort>('recommended')
  const [tab, setTab] = useState<CatalogTabKey>(lockedTab ?? 'all')
  // useDeferredValue mantiene el input fluido mientras se refiltra la rejilla.
  const deferredQuery = useDeferredValue(query)

  const activeTab = lockedTab ?? tab
  const region = catalogTab(activeTab)?.region ?? 'peninsula'

  /**
   * Base del catálogo para la región activa. Canarias es una lista de precios
   * distinta, no una exención: mezclarla con la peninsular daría totales
   * incoherentes, así que las dos nunca se ven juntas.
   */
  const inRegion = useMemo(
    () =>
      products.filter((p) =>
        isCatalogVisible(p, { purchaseType, region }),
      ),
    [products, purchaseType, region],
  )

  const counts = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const t of CATALOG_TABS) {
      acc[t.key] = products.filter((p) =>
        isCatalogVisible(p, { purchaseType, region: t.region }),
      ).filter((p) => (t.category ? p.category === t.category : true)).length
    }
    return acc
  }, [products, purchaseType])

  const filtered = useMemo(() => {
    const needle = normalizeSearch(deferredQuery.trim())
    const tabDef = catalogTab(activeTab)

    const result = inRegion.filter((p) => {
      if (tabDef?.category && p.category !== tabDef.category) return false
      if (!needle) return true
      return normalizeSearch(
        [
          p.name,
          p.brand ?? '',
          p.model ?? '',
          p.summary ?? '',
          p.ideal_for ?? '',
          ...(p.highlights ?? []),
        ].join(' '),
      ).includes(needle)
    })

    // Al ordenar por precio, los que no tienen cifra con la que compararse
    // (Software Qamarero, oferta mixta) van a los extremos.
    const priceOf = (p: Product, fallback: number) => {
      if (!isFreePrice(p)) return p.price_cents
      // Los de precio libre CON tarifa (Implementación Pro) sí tienen cifra:
      // mandarlos al extremo chirriaba, porque la tarjeta enseña 500 €.
      return referencePriceCents(p) ?? fallback
    }

    if (sort === 'price-asc') {
      return [...result].sort(
        (a, b) =>
          priceOf(a, Number.POSITIVE_INFINITY) -
          priceOf(b, Number.POSITIVE_INFINITY),
      )
    }
    if (sort === 'price-desc') {
      return [...result].sort(
        (a, b) =>
          priceOf(b, Number.NEGATIVE_INFINITY) -
          priceOf(a, Number.NEGATIVE_INFINITY),
      )
    }
    if (sort === 'name') {
      return [...result].sort((a, b) => a.name.localeCompare(b.name, 'es'))
    }
    // 'recommended' = el orden comercial curado de sort_order, que ya viene
    // ordenado del endpoint.
    return result
  }, [inRegion, deferredQuery, activeTab, sort])

  function reset() {
    setQuery('')
    setSort('recommended')
    if (!lockedTab) setTab('all')
  }

  // Con la pestaña fijada por contexto (servicios, Canarias) el usuario no la
  // eligió, así que no cuenta como filtro "sucio": si contara, el botón
  // Restablecer estaría siempre visible sin nada que restablecer.
  const dirty =
    Boolean(query) ||
    sort !== 'recommended' ||
    (!lockedTab && activeTab !== 'all')
  const canarias = region === 'canarias'

  return (
    <section
      id="catalogo"
      className={showHeading ? 'catalog-explorer section-shell' : 'catalog-explorer embedded'}
      aria-labelledby={showHeading ? 'catalog-title' : undefined}
    >
      {showHeading && (
        <div className="section-heading">
          <div>
            <span className="eyebrow">Elige por tipo de operativa</span>
            <h2 id="catalog-title">Encuentra el equipo adecuado</h2>
          </div>
          <p>
            Empieza por una familia o busca por necesidad: caja, barra, cocina,
            WiFi o venta al peso.
          </p>
        </div>
      )}

      {!lockedTab && (
        <CategoryGuides
          active={activeTab}
          counts={counts}
          onChange={setTab}
          visibleTabs={visibleTabs}
        />
      )}

      <CatalogToolbar
        query={query}
        onQueryChange={setQuery}
        sort={sort}
        onSortChange={setSort}
      />

      <CatalogResultsMeta
        count={filtered.length}
        canReset={dirty}
        onReset={reset}
      />

      {filtered.length ? (
        <ProductGrid>
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              qty={qtyByProductId.get(p.id) ?? 0}
              mode={mode}
              onOpenDetail={onOpenDetail}
              onAdd={onAdd}
              onInc={onInc}
              onDec={onDec}
              // El precio de estos productos se acuerda en la línea del
              // pedido, así que en el catálogo la cantidad se fija a 1.
              lockQty={isFreePrice(p)}
              stock={stockFor?.(p)}
            />
          ))}
        </ProductGrid>
      ) : (
        <EmptyResults onReset={reset} />
      )}

      <p className="commercial-note">
        {canarias
          ? 'Precios finales para Canarias, sin IVA. Disponibilidad sujeta a confirmación.'
          : 'Precios sin IVA. Disponibilidad sujeta a confirmación.'}
      </p>
    </section>
  )
}
