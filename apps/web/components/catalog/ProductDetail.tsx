'use client'

import Image from 'next/image'
import { Check } from 'lucide-react'
import type { Product } from '@/types/database'
import { productImageUrl } from '@/lib/product-rules'
import { categoryMeta } from '@/lib/catalog-taxonomy'
import { catalogIcon } from './catalog-icons'
import AddToOrderButton from './AddToOrderButton'
import ComponentsCard from './ComponentsCard'
import IdealForCard from './IdealForCard'
import InternalNote from './InternalNote'
import ModelOptions from './ModelOptions'
import PackComparison from './PackComparison'
import PriceTag from './PriceTag'
import ProductBadge from './ProductBadge'
import SpecTable from './SpecTable'
import StockPill from './StockPill'
import type { ProductStockState } from '@/lib/stock/compute'

interface ProductDetailProps {
  product: Product
  qty: number
  onAdd: (product: Product) => void
  onInc: (product: Product) => void
  onDec: (product: Product) => void
  lockQty?: boolean
  /** Contenido del bloque inferior (productos relacionados). */
  related?: React.ReactNode
  /** Stock del producto (lib/stock). Sin él, la ficha no limita nada. */
  stock?: ProductStockState
}

export default function ProductDetail({
  product,
  qty,
  onAdd,
  onInc,
  onDec,
  lockQty = false,
  related,
  stock,
}: ProductDetailProps) {
  const image = productImageUrl(product)
  const meta = categoryMeta(product.category)
  const FallbackIcon = catalogIcon(meta?.icon ?? 'Package')
  const specs = product.specifications ?? []
  const highlights = product.highlights ?? []
  const isCanarias = product.region === 'canarias'

  return (
    <>
      <section className="detail-shell section-shell">
        <div className="detail-grid">
          <div className="detail-media">
            {product.badge && (
              <ProductBadge label={product.badge} variant="detail" />
            )}
            {image ? (
              <Image
                src={image}
                alt={product.name}
                fill
                sizes="(max-width: 900px) 100vw, 45vw"
                priority
              />
            ) : (
              <span className="product-media-fallback">
                <FallbackIcon size={64} aria-hidden="true" />
              </span>
            )}
          </div>

          <div className="detail-copy">
            <span className="eyebrow">
              {[product.brand, product.model].filter(Boolean).join(' · ') ||
                meta?.label}
            </span>
            <h1>{product.name}</h1>
            <p className="detail-summary">
              {product.summary ?? product.description ?? ''}
            </p>

            <PriceTag product={product} variant="detail" />

            <StockPill stock={stock} variant="inline" />

            {isCanarias && (
              <p className="canarias-tax-note">
                Precio final para Canarias, sin IVA
              </p>
            )}

            <PackComparison product={product} variant="detail" />

            {highlights.length > 0 && (
              <ul className="highlight-list">
                {highlights.map((h) => (
                  <li key={h}>
                    <Check size={18} aria-hidden="true" />
                    {h}
                  </li>
                ))}
              </ul>
            )}

            {product.model_options && product.model_options.length > 0 && (
              <ModelOptions
                options={product.model_options}
                note={product.model_availability_note}
              />
            )}

            <div className="detail-actions">
              <AddToOrderButton
                qty={qty}
                productName={product.name}
                onAdd={() => onAdd(product)}
                onInc={() => onInc(product)}
                onDec={() => onDec(product)}
                lockQty={lockQty}
                maxQty={stock?.maxQty}
              />
            </div>

            {product.availability_note && (
              <p className="commercial-note">{product.availability_note}</p>
            )}
          </div>
        </div>
      </section>

      {(specs.length > 0 ||
        product.ideal_for ||
        (product.components ?? []).length > 0 ||
        product.internal_note) && (
        <section className="detail-info">
          <div className="section-shell detail-info-grid">
            <div>
              <span className="eyebrow">Ficha técnica</span>
              <h2>Especificaciones</h2>
              <SpecTable specs={specs} />
            </div>
            <aside>
              {product.ideal_for && <IdealForCard text={product.ideal_for} />}
              <ComponentsCard items={product.components ?? []} />
              {product.internal_note && (
                <InternalNote note={product.internal_note} />
              )}
            </aside>
          </div>
        </section>
      )}

      {related}
    </>
  )
}
