// =============================================================
// Tests: lib/product-rules.ts
//
// Cubre las dos rutas del módulo:
//   * declarativa  — la fila trae pricing_mode / allows_discount / region.
//   * fallback     — la fila aún no está migrada (el SQL se aplica a mano,
//                    CLAUDE.md), así que las reglas se deducen del `code`.
// =============================================================

import { describe, it, expect } from 'vitest'
import type { ProductLike } from '@/lib/product-rules'
import {
  allowsLineDiscount,
  isCatalogVisible,
  isFreePrice,
  isHiddenFromCatalog,
  needsCustomName,
  packSavingCents,
  productImageUrl,
  productRegion,
  productRules,
  referencePriceCents,
  requiresCanaryShipping,
  PRODUCT_IMAGE_FALLBACK,
} from '@/lib/product-rules'

const catalogProduct: ProductLike = {
  code: 'tpv-pro',
  category: 'tpv',
  price_cents: 62700,
  pricing_mode: 'catalog',
  allows_discount: true,
  region: 'peninsula',
}

const canaryProduct: ProductLike = {
  code: 'tpv-pro-canarias',
  category: 'tpv',
  price_cents: 53907,
  pricing_mode: 'catalog',
  allows_discount: true,
  region: 'canarias',
}

const freePriceService: ProductLike = {
  code: 'implementacion-pro',
  category: 'service',
  price_cents: 0,
  pricing_mode: 'free_price',
  allows_discount: true,
  region: 'peninsula',
}

const closedOffer: ProductLike = {
  code: 'saas_hardware',
  category: 'service',
  price_cents: 0,
  pricing_mode: 'free_price_named',
  allows_discount: false,
  region: 'peninsula',
}

const freeLineSku: ProductLike = {
  code: 'otro',
  category: 'custom',
  price_cents: 0,
  pricing_mode: 'free_price_named',
  allows_discount: true,
}

describe('precio libre y descripción libre', () => {
  it('un producto de catálogo no lleva precio ni nombre libres', () => {
    expect(isFreePrice(catalogProduct)).toBe(false)
    expect(needsCustomName(catalogProduct)).toBe(false)
  })

  it('free_price pide precio pero no descripción', () => {
    expect(isFreePrice(freePriceService)).toBe(true)
    expect(needsCustomName(freePriceService)).toBe(false)
  })

  it('free_price_named pide precio Y descripción', () => {
    expect(isFreePrice(closedOffer)).toBe(true)
    expect(needsCustomName(closedOffer)).toBe(true)
    expect(isFreePrice(freeLineSku)).toBe(true)
    expect(needsCustomName(freeLineSku)).toBe(true)
  })

  it('null/undefined no rompen', () => {
    expect(isFreePrice(null)).toBe(false)
    expect(needsCustomName(undefined)).toBe(false)
    expect(allowsLineDiscount(null)).toBe(true)
  })
})

describe('descuento por línea', () => {
  it('respeta allows_discount de la fila', () => {
    expect(allowsLineDiscount(catalogProduct)).toBe(true)
    expect(allowsLineDiscount(closedOffer)).toBe(false)
  })

  it('allows_discount = false gana sobre el pricing_mode', () => {
    // Implementación Pro también es precio libre, pero SÍ admite descuento.
    expect(allowsLineDiscount(freePriceService)).toBe(true)
  })
})

describe('fallback para filas sin migrar', () => {
  // Sin pricing_mode ni allows_discount: se deduce del code/category.
  it('deduce precio libre por code', () => {
    expect(isFreePrice({ code: 'otro', category: 'custom' })).toBe(true)
    expect(isFreePrice({ code: 'implementacion-pro', category: 'accessory' })).toBe(true)
    expect(isFreePrice({ code: 'software-qamarero', category: 'accessory' })).toBe(true)
    expect(isFreePrice({ code: 'tpv-pro', category: 'tpv' })).toBe(false)
  })

  it('distingue quién necesita descripción', () => {
    expect(needsCustomName({ code: 'otro', category: 'custom' })).toBe(true)
    expect(needsCustomName({ code: 'saas_hardware', category: 'saas_hardware' })).toBe(true)
    // Nombre fijo del catálogo: solo precio.
    expect(needsCustomName({ code: 'implementacion-pro', category: 'accessory' })).toBe(false)
  })

  it('deduce el bloqueo de descuento por la categoría vieja', () => {
    expect(allowsLineDiscount({ code: 'saas_hardware', category: 'saas_hardware' })).toBe(false)
    expect(allowsLineDiscount({ code: 'tpv-pro', category: 'tpv' })).toBe(true)
  })

  it('sin region asume península', () => {
    expect(productRegion({ code: 'tpv-pro', category: 'tpv' })).toBe('peninsula')
    expect(requiresCanaryShipping({ code: 'tpv-pro', category: 'tpv' })).toBe(false)
  })
})

describe('región', () => {
  it('los SKU canarios exigen envío a Canarias', () => {
    expect(requiresCanaryShipping(canaryProduct)).toBe(true)
    expect(requiresCanaryShipping(catalogProduct)).toBe(false)
  })

  it('el precio canario NO es el peninsular con IVA 0', () => {
    // Es otra lista de precios: 627 € + IVA en península, 539,07 € finales
    // en Canarias. Por eso son SKU distintos y no un flag.
    expect(catalogProduct.price_cents).toBe(62700)
    expect(canaryProduct.price_cents).toBe(53907)
    expect(canaryProduct.price_cents).not.toBe(catalogProduct.price_cents)
  })
})

describe('imagen', () => {
  it('usa image_url cuando existe', () => {
    expect(productImageUrl({ ...catalogProduct, image_url: '/products/tpv-pro.webp' }))
      .toBe('/products/tpv-pro.webp')
  })

  it('cae al nombre por code mientras la columna no esté poblada', () => {
    expect(productImageUrl(catalogProduct)).toBe('/products/tpv-pro.webp')
  })

  it('columna vacia (null) significa sin foto -> icono', () => {
    // saas_hardware y otro no tienen imagen a proposito.
    expect(productImageUrl({ ...catalogProduct, image_url: null })).toBeNull()
  })

  it('sin producto devuelve null', () => {
    expect(productImageUrl(null)).toBeNull()
  })

  it('los dos SKU de servicio caen a .svg en la ventana pre-migracion', () => {
    expect(productImageUrl({ code: 'implementacion-pro', category: 'service' }))
      .toBe('/products/implementacion-pro.svg')
    expect(productImageUrl({ code: 'software-qamarero', category: 'service' }))
      .toBe('/products/software-qamarero.svg')
  })

  it('PRODUCT_IMAGE_FALLBACK apunta al placeholder vectorial', () => {
    expect(PRODUCT_IMAGE_FALLBACK).toBe('/products/_pending.svg')
  })
})

describe('ahorro del pack', () => {
  it('calcula standalone - precio', () => {
    const pack: ProductLike = {
      code: 'pack-esencial',
      category: 'pack',
      price_cents: 49900,
      standalone_price_cents: 59900,
    }
    expect(packSavingCents(pack)).toBe(10000)
  })

  it('puede ser negativo (la preconfiguración añade coste)', () => {
    const pack: ProductLike = {
      code: 'pack-x',
      category: 'pack',
      price_cents: 60000,
      standalone_price_cents: 55000,
    }
    expect(packSavingCents(pack)).toBe(-5000)
  })

  it('sin desglose devuelve null', () => {
    expect(packSavingCents(catalogProduct)).toBeNull()
    expect(packSavingCents(null)).toBeNull()
  })
})

describe('visibilidad en el catálogo', () => {
  it('oculta el SKU de línea libre', () => {
    expect(isHiddenFromCatalog(freeLineSku)).toBe(true)
    expect(isCatalogVisible(freeLineSku)).toBe(false)
  })

  it('los servicios SÍ tienen tarjeta', () => {
    expect(isHiddenFromCatalog(freePriceService)).toBe(false)
    expect(isCatalogVisible(freePriceService)).toBe(true)
    expect(isCatalogVisible(closedOffer)).toBe(true)
  })

  it('nunca mezcla península y Canarias', () => {
    expect(isCatalogVisible(catalogProduct, { region: 'peninsula' })).toBe(true)
    expect(isCatalogVisible(catalogProduct, { region: 'canarias' })).toBe(false)
    expect(isCatalogVisible(canaryProduct, { region: 'canarias' })).toBe(true)
    expect(isCatalogVisible(canaryProduct, { region: 'peninsula' })).toBe(false)
  })

  it('transferencias SaaS solo muestra software e implementación', () => {
    const ctx = { purchaseType: 'transferencias_saas' as const }
    expect(isCatalogVisible(freePriceService, ctx)).toBe(true)
    expect(
      isCatalogVisible({ code: 'software-qamarero', category: 'service' }, ctx),
    ).toBe(true)
    expect(isCatalogVisible(catalogProduct, ctx)).toBe(false)
    expect(isCatalogVisible(closedOffer, ctx)).toBe(false)
  })

  it('Software Qamarero está oculto fuera de transferencias SaaS', () => {
    const sw: ProductLike = { code: 'software-qamarero', category: 'service' }
    expect(isCatalogVisible(sw, { purchaseType: 'hardware_one_off' })).toBe(false)
    expect(isCatalogVisible(sw, {})).toBe(false)
  })
})

describe('productRules (struct agregado)', () => {
  it('coincide con los predicados sueltos', () => {
    const r = productRules(closedOffer)
    expect(r).toMatchObject({
      freePrice: true,
      needsName: true,
      discountLocked: true,
      region: 'peninsula',
      requiresCanaryShipping: false,
      hiddenFromCatalog: false,
    })
  })

  it('marca financiable solo los del plan', () => {
    expect(productRules({ code: 'pack-pro', category: 'pack' }).financeable).toBe(true)
    expect(productRules({ code: 'kds-pro', category: 'kds' }).financeable).toBe(true)
    expect(productRules({ code: 'kds-premium', category: 'kds' }).financeable).toBe(true)
    // Desde el 2026-10-21 el KDS Standard ya no se financia (como en la web).
    expect(productRules({ code: 'kds-estandar', category: 'kds' }).financeable).toBe(false)
    expect(productRules(catalogProduct).financeable).toBe(false)
  })
})

describe('precio de referencia', () => {
  // El caso que motivó la migración 20260827000001: Implementación Pro tiene
  // tarifa (500 €) y lo que varía es el descuento, pero salía como
  // «Precio a medida» porque el CHECK obligaba a price_cents = 0.
  const implPro: ProductLike = {
    code: 'implementacion-pro',
    category: 'service',
    price_cents: 50000,
    pricing_mode: 'free_price',
    allows_discount: true,
  }

  it('devuelve la tarifa de un producto de precio libre que la tenga', () => {
    expect(referencePriceCents(implPro)).toBe(50000)
  })

  it('un producto de catálogo no tiene precio de referencia: su precio es el precio', () => {
    expect(referencePriceCents(catalogProduct)).toBeNull()
  })

  it('precio libre a 0 sigue siendo «a convenir»', () => {
    expect(
      referencePriceCents({
        code: 'software-qamarero',
        category: 'service',
        price_cents: 0,
        pricing_mode: 'free_price',
      }),
    ).toBeNull()
  })

  it('tolera la BD pre-migración: sin price_cents no hay tarifa', () => {
    expect(
      referencePriceCents({ code: 'implementacion-pro', category: 'service' }),
    ).toBeNull()
  })

  it('null y undefined no revientan', () => {
    expect(referencePriceCents(null)).toBeNull()
    expect(referencePriceCents(undefined)).toBeNull()
  })
})
