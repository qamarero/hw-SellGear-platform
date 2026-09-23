// =============================================================
// Tests: lib/catalog/rules.ts — reducers del carrito.
//
// Estas reglas vivían dentro de ProductCatalog.tsx, donde no había forma de
// probarlas sin renderizar. El invariante que más importa es el del regalo:
// quitar Implementación Pro tiene que arrastrar la tablet de 100 % de
// descuento, o queda una tablet gratis sin el servicio que la justifica.
// =============================================================

import { describe, it, expect } from 'vitest'
import type { Product } from '@/types/database'
import {
  EMPTY_LINE,
  GIFT_DISCOUNT_PCT,
  IMPL_PRO_CODE,
  TABLET_GIFT_CODE,
  TABLET_GIFT_NOTE,
  applyAddFreeLine,
  applyAddProduct,
  applyAddTabletGift,
  applyAdjustQty,
  applyDeclineTabletGift,
  applyRemoveLine,
  applySelectFinanced,
  applyUpdateLine,
  findByCode,
  hasProduct,
  isGiftLine,
  qtyByProduct,
  tabletGiftIndex,
  type CartLineState,
} from '@/lib/catalog/rules'

function product(id: string, code: string, priceCents = 10000): Product {
  return {
    id,
    code,
    name: code,
    description: null,
    category: 'accessory',
    price_cents: priceCents,
    vat_rate: 21,
    package_count: 1,
    active: true,
    sort_order: 0,
    created_at: '',
    updated_at: '',
  }
}

const tpv = product('id-tpv', 'tpv-pro', 62700)
const implPro = product('id-impl', IMPL_PRO_CODE, 0)
const tablet = product('id-tablet', TABLET_GIFT_CODE, 19900)
const CATALOG = [tpv, implPro, tablet]

const line = (over: Partial<CartLineState>): CartLineState => ({
  ...EMPTY_LINE,
  ...over,
})

describe('applyAddProduct', () => {
  it('añade una línea nueva con cantidad 1', () => {
    const next = applyAddProduct([], tpv)
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ product_id: tpv.id, qty: 1, discount_pct: 0 })
  })

  it('suma cantidad si el producto ya está', () => {
    const next = applyAddProduct([line({ product_id: tpv.id, qty: 2 })], tpv)
    expect(next).toHaveLength(1)
    expect(next[0].qty).toBe(3)
  })

  it('no muta el array de entrada', () => {
    const items = [line({ product_id: tpv.id, qty: 1 })]
    const next = applyAddProduct(items, tpv)
    expect(items[0].qty).toBe(1)
    expect(next).not.toBe(items)
  })
})

// El regalo de Implementación Pro es UNA tablet. La segunda se cobra, así que
// no puede sumarse a la línea regalada: hasta que esto se arregló, añadir otra
// tablet desde el catálogo subía la del 100 % y se regalaban las dos.
describe('applyAddProduct con la tablet ya regalada', () => {
  const gift = () =>
    line({
      product_id: tablet.id,
      qty: 1,
      discount_pct: GIFT_DISCOUNT_PCT,
      notes: TABLET_GIFT_NOTE,
    })

  it('la segunda tablet abre línea propia a precio normal', () => {
    const next = applyAddProduct([gift()], tablet)

    expect(next).toHaveLength(2)
    expect(next[0]).toMatchObject({ qty: 1, discount_pct: GIFT_DISCOUNT_PCT })
    expect(next[1]).toMatchObject({
      product_id: tablet.id,
      qty: 1,
      discount_pct: 0,
      notes: null,
    })
  })

  it('la tercera suma en la línea de pago, no en la del regalo', () => {
    const next = applyAddProduct(applyAddProduct([gift()], tablet), tablet)

    expect(next).toHaveLength(2)
    expect(next[0].qty).toBe(1)
    expect(next[1].qty).toBe(2)
  })

  it('el regalo sigue intacto y sigue siendo localizable', () => {
    const next = applyAddProduct([gift()], tablet)

    expect(tabletGiftIndex(next, tablet)).toBe(0)
    expect(next[0].notes).toBe(TABLET_GIFT_NOTE)
  })

  it('qtyByProduct cuenta las dos líneas', () => {
    const next = applyAddProduct([gift()], tablet)
    expect(qtyByProduct(next).get(tablet.id)).toBe(2)
  })
})

describe('applyAdjustQty con regalo y línea de pago', () => {
  const gift = () =>
    line({
      product_id: tablet.id,
      qty: 1,
      discount_pct: GIFT_DISCOUNT_PCT,
      notes: TABLET_GIFT_NOTE,
    })

  it('resta de la línea de pago, no de la regalada', () => {
    const items = [gift(), line({ product_id: tablet.id, qty: 2 })]
    const next = applyAdjustQty(items, tablet.id, -1)

    expect(next[0].qty).toBe(1)
    expect(next[1].qty).toBe(1)
  })

  it('al agotar la línea de pago el regalo se queda', () => {
    const items = [gift(), line({ product_id: tablet.id, qty: 1 })]
    const next = applyAdjustQty(items, tablet.id, -1)

    expect(next).toHaveLength(1)
    expect(next[0].discount_pct).toBe(GIFT_DISCOUNT_PCT)
  })

  it('restar con solo el regalo lo retira', () => {
    expect(applyAdjustQty([gift()], tablet.id, -1)).toHaveLength(0)
  })

  it('sumar sobre el regalo no hace nada: esa unidad la crea applyAddProduct', () => {
    const items = [gift()]
    expect(applyAdjustQty(items, tablet.id, 1)).toBe(items)
  })

  it('sumar va a la línea de pago cuando existe', () => {
    const items = [gift(), line({ product_id: tablet.id, qty: 1 })]
    const next = applyAdjustQty(items, tablet.id, 1)

    expect(next[0].qty).toBe(1)
    expect(next[1].qty).toBe(2)
  })
})

describe('isGiftLine', () => {
  it('marca solo el 100 % de descuento', () => {
    expect(isGiftLine(line({ discount_pct: GIFT_DISCOUNT_PCT }))).toBe(true)
    expect(isGiftLine(line({ discount_pct: 99 }))).toBe(false)
    expect(isGiftLine(line({ discount_pct: 0 }))).toBe(false)
  })
})

describe('applyAdjustQty', () => {
  it('sube y baja la cantidad', () => {
    const items = [line({ product_id: tpv.id, qty: 2 })]
    expect(applyAdjustQty(items, tpv.id, 1)[0].qty).toBe(3)
    expect(applyAdjustQty(items, tpv.id, -1)[0].qty).toBe(1)
  })

  it('elimina la línea al llegar a 0', () => {
    const items = [line({ product_id: tpv.id, qty: 1 })]
    expect(applyAdjustQty(items, tpv.id, -1)).toHaveLength(0)
  })

  it('ignora un producto que no está en el carrito', () => {
    const items = [line({ product_id: tpv.id, qty: 1 })]
    expect(applyAdjustQty(items, 'inexistente', -1)).toBe(items)
  })

  it('quitar Implementación Pro arrastra la tablet regalo', () => {
    const items = [
      line({ product_id: implPro.id, qty: 1, unit_price_override_cents: 50000 }),
      line({ product_id: tablet.id, qty: 1, discount_pct: GIFT_DISCOUNT_PCT }),
    ]
    const next = applyAdjustQty(items, implPro.id, -1, { implPro, tablet })
    expect(next).toHaveLength(0)
  })

  it('pero NO arrastra una tablet comprada aparte', () => {
    // Sin descuento 100 % no es un regalo: es una tablet que el cliente paga.
    const items = [
      line({ product_id: implPro.id, qty: 1 }),
      line({ product_id: tablet.id, qty: 1, discount_pct: 0 }),
    ]
    const next = applyAdjustQty(items, implPro.id, -1, { implPro, tablet })
    expect(next).toHaveLength(1)
    expect(next[0].product_id).toBe(tablet.id)
  })

  it('bajar Implementación Pro sin llegar a 0 no toca el regalo', () => {
    const items = [
      line({ product_id: implPro.id, qty: 2 }),
      line({ product_id: tablet.id, qty: 1, discount_pct: GIFT_DISCOUNT_PCT }),
    ]
    const next = applyAdjustQty(items, implPro.id, -1, { implPro, tablet })
    expect(next).toHaveLength(2)
    expect(next[0].qty).toBe(1)
  })
})

describe('tablet regalo', () => {
  it('la añade con 100 % de descuento', () => {
    const next = applyAddTabletGift([], tablet)
    expect(next[0]).toMatchObject({
      product_id: tablet.id,
      qty: 1,
      discount_pct: GIFT_DISCOUNT_PCT,
    })
  })

  it('es idempotente', () => {
    const once = applyAddTabletGift([], tablet)
    expect(applyAddTabletGift(once, tablet)).toBe(once)
  })

  it('sin tablet en el catálogo no hace nada', () => {
    const items: CartLineState[] = []
    expect(applyAddTabletGift(items, null)).toBe(items)
  })

  it('declinar quita solo la línea de regalo', () => {
    const items = [
      line({ product_id: tpv.id, qty: 1 }),
      line({ product_id: tablet.id, qty: 1, discount_pct: GIFT_DISCOUNT_PCT }),
    ]
    const next = applyDeclineTabletGift(items, tablet)
    expect(next).toHaveLength(1)
    expect(next[0].product_id).toBe(tpv.id)
  })

  it('tabletGiftIndex localiza la línea por SKU + descuento', () => {
    const items = [
      line({ product_id: tablet.id, qty: 1, discount_pct: 0 }),
      line({ product_id: tablet.id, qty: 1, discount_pct: GIFT_DISCOUNT_PCT }),
    ]
    expect(tabletGiftIndex(items, tablet)).toBe(1)
    expect(tabletGiftIndex(items, null)).toBe(-1)
  })
})

describe('líneas libres y utilidades', () => {
  it('applyAddFreeLine añade una línea en blanco', () => {
    const next = applyAddFreeLine([])
    expect(next[0]).toEqual(EMPTY_LINE)
    expect(next[0].product_id).toBeNull()
  })

  it('applyUpdateLine solo toca el índice indicado', () => {
    const items = [line({ qty: 1 }), line({ qty: 5 })]
    const next = applyUpdateLine(items, 1, { qty: 9 })
    expect(next[0].qty).toBe(1)
    expect(next[1].qty).toBe(9)
  })

  it('applyRemoveLine quita por índice', () => {
    const items = [line({ qty: 1 }), line({ qty: 2 })]
    expect(applyRemoveLine(items, 0)).toHaveLength(1)
    expect(applyRemoveLine(items, 0)[0].qty).toBe(2)
  })

  it('qtyByProduct agrega y salta líneas sin producto', () => {
    const map = qtyByProduct([
      line({ product_id: tpv.id, qty: 2 }),
      line({ product_id: tpv.id, qty: 3 }),
      line({ product_id: null, qty: 7 }),
    ])
    expect(map.get(tpv.id)).toBe(5)
    expect(map.size).toBe(1)
  })

  it('hasProduct y findByCode', () => {
    expect(hasProduct([line({ product_id: tpv.id })], tpv.id)).toBe(true)
    expect(hasProduct([], tpv.id)).toBe(false)
    expect(findByCode(CATALOG, TABLET_GIFT_CODE)).toBe(tablet)
    expect(findByCode(CATALOG, 'no-existe')).toBeNull()
  })
})

describe('applySelectFinanced', () => {
  it('reemplaza el carrito por una única línea sin descuento', () => {
    // Es lo que valida POST /api/orders para hardware_financiacion.
    const next = applySelectFinanced(tpv)
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ product_id: tpv.id, qty: 1, discount_pct: 0 })
  })
})

describe('applyAddProduct con precio de referencia', () => {
  // Implementación Pro tras la migración 20260827000001: entra con sus 500 €
  // ya puestos para que el AE no tenga que saberse la tarifa, y sigue siendo
  // editable en la línea.
  const implProConTarifa: Product = {
    ...implPro,
    price_cents: 50000,
    pricing_mode: 'free_price',
  } as Product

  it('prerrellena el importe de un precio libre con tarifa', () => {
    const next = applyAddProduct([], implProConTarifa)
    expect(next[0].unit_price_override_cents).toBe(50000)
  })

  it('un producto de catálogo no lleva override: su precio es el de tarifa', () => {
    expect(applyAddProduct([], tpv)[0].unit_price_override_cents).toBeNull()
  })

  it('un precio libre sin tarifa entra a null y el paso 2 lo bloquea', () => {
    // implPro del fixture tiene price_cents = 0 (estado pre-migración).
    expect(applyAddProduct([], implPro)[0].unit_price_override_cents).toBeNull()
  })

  it('sumar cantidad no toca el importe que ya hubiera tecleado el AE', () => {
    const items = [
      line({ product_id: implProConTarifa.id, qty: 1, unit_price_override_cents: 35000 }),
    ]
    const next = applyAddProduct(items, implProConTarifa)
    expect(next[0].qty).toBe(2)
    expect(next[0].unit_price_override_cents).toBe(35000)
  })
})

describe('nota de la línea de regalo', () => {
  // order_items.notes es la columna que lee quien prepara el envío. Sin ella
  // una tablet a 0 € parece un descuento equivocado y se queda sin enviar,
  // así que esto es traza operativa, no cosmética.
  it('applyAddTabletGift deja la nota en la línea', () => {
    const next = applyAddTabletGift([], tablet)
    expect(next[0]).toMatchObject({
      product_id: tablet.id,
      qty: 1,
      discount_pct: GIFT_DISCOUNT_PCT,
      notes: TABLET_GIFT_NOTE,
    })
  })

  it('la línea vacía y las de catálogo no llevan nota', () => {
    expect(EMPTY_LINE.notes).toBeNull()
    expect(applyAddProduct([], tpv)[0].notes).toBeNull()
    expect(applyAddFreeLine([])[0].notes).toBeNull()
  })

  it('una tablet comprada (no regalada) no lleva la nota del regalo', () => {
    expect(applyAddProduct([], tablet)[0].notes).toBeNull()
  })

  it('sigue siendo idempotente: no duplica la línea ni la nota', () => {
    const once = applyAddTabletGift([], tablet)
    expect(applyAddTabletGift(once, tablet)).toBe(once)
  })

  it('applyDeclineTabletGift se lleva la línea con su nota', () => {
    const withGift = applyAddTabletGift([], tablet)
    expect(applyDeclineTabletGift(withGift, tablet)).toHaveLength(0)
  })
})
