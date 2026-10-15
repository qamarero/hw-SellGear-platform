'use client'

import Image from 'next/image'
import Link from 'next/link'
import type { Product } from '@/types/database'
import { productImageUrl } from '@/lib/product-rules'
import { catalogIcon } from './catalog-icons'
import { categoryMeta } from '@/lib/catalog-taxonomy'
import AddToOrderButton from './AddToOrderButton'
import ModelOptions from './ModelOptions'
import PackComparison from './PackComparison'
import PriceTag from './PriceTag'
import ProductBadge from './ProductBadge'
import StockPill from './StockPill'
import type { ProductStockState } from '@/lib/stock/compute'

interface ProductCardProps {
  product: Product
  /** Unidades ya en el pedido. 0 = no está. */
  qty: number
  /**
   * Cómo se abre la ficha:
   *   'link'   — navega a /catalogo/producto/[code]. Para la ruta /catalogo.
   *   'inline' — llama a onOpenDetail para abrirla en modal. OBLIGATORIO en
   *              el wizard: navegar allí perdería el useState del formulario
   *              (paso, datos del cliente, carrito).
   *   'static' — sin ficha (financiación: 3 productos, no hace falta).
   */
  mode?: 'link' | 'inline' | 'static'
  onOpenDetail?: (product: Product) => void
  onAdd: (product: Product) => void
  onInc: (product: Product) => void
  onDec: (product: Product) => void
  /** Selección única (financiación). */
  single?: boolean
  /** Cantidad fija a 1: productos de precio libre. */
  lockQty?: boolean
  /** Slot para contenido extra en el pie (plan de plazos de financiación). */
  footerExtra?: React.ReactNode
  /** Stock del producto (lib/stock). Sin él, la tarjeta no limita nada. */
  stock?: ProductStockState
}

export default function ProductCard({
  product,
  qty,
  mode = 'link',
  onOpenDetail,
  onAdd,
  onInc,
  onDec,
  single = false,
  lockQty = false,
  footerExtra,
  stock,
}: ProductCardProps) {
  const inOrder = qty > 0
  const href = `/catalogo/producto/${product.code}`
  const image = productImageUrl(product)
  const meta = categoryMeta(product.category)
  const FallbackIcon = catalogIcon(meta?.icon ?? 'Package')
  // Los packs enseñan 4 bullets; el resto 3. Igual que el catálogo web.
  const highlights = (product.highlights ?? []).slice(
    0,
    product.category === 'pack' ? 4 : 3,
  )

  const media = (
    <>
      {product.badge && <ProductBadge label={product.badge} />}
      {inOrder && (
        <span className="product-qty-badge">
          {single ? 'Seleccionado' : `× ${qty}`}
        </span>
      )}
      <StockPill stock={stock} />
      {image ? (
        <Image
          src={image}
          alt={product.name}
          fill
          sizes="(max-width: 700px) 100vw, (max-width: 1100px) 45vw, 30vw"
          className="product-image"
        />
      ) : (
        <span className="product-media-fallback">
          <FallbackIcon size={44} aria-hidden="true" />
        </span>
      )}
    </>
  )

  const title = <h3>{product.name}</h3>

  return (
    <article className={inOrder ? 'product-card in-cart' : 'product-card'}>
      {mode === 'link' ? (
        <Link href={href} className="product-media" aria-label={`Ver ${product.name}`}>
          {media}
        </Link>
      ) : mode === 'inline' ? (
        <button
          type="button"
          className="product-media"
          onClick={() => onOpenDetail?.(product)}
          aria-label={`Ver ficha de ${product.name}`}
        >
          {media}
        </button>
      ) : (
        <div className="product-media">{media}</div>
      )}

      <div className="product-content">
        <div className="product-meta">
          {product.brand && <span>{product.brand}</span>}
          {product.model && <span>{product.model}</span>}
        </div>

        {mode === 'link' ? (
          <Link href={href} className="product-title-link">
            {title}
          </Link>
        ) : mode === 'inline' ? (
          <button
            type="button"
            className="product-title-link"
            onClick={() => onOpenDetail?.(product)}
          >
            {title}
          </button>
        ) : (
          <div className="product-title-link">{title}</div>
        )}

        {product.model_options && product.model_options.length > 0 && (
          <ModelOptions
            options={product.model_options}
            note={product.model_availability_note}
            compact
          />
        )}

        <p>{product.ideal_for ?? product.summary ?? product.description ?? ''}</p>

        {highlights.length > 0 && (
          <ul className="mini-specs" aria-label="Características principales">
            {highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}

        <PackComparison product={product} />

        <div className="product-card-footer">
          <PriceTag product={product} />
          <AddToOrderButton
            qty={qty}
            productName={product.name}
            onAdd={() => onAdd(product)}
            onInc={() => onInc(product)}
            onDec={() => onDec(product)}
            single={single}
            lockQty={lockQty}
            maxQty={stock?.maxQty}
          />
        </div>

        {footerExtra}
      </div>
    </article>
  )
}
