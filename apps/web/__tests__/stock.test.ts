// =============================================================
// Tests: lib/stock/compute.ts — pedidos limitados al stock real.
//
// Los invariantes que importan:
//   · pools compartidos: TPV Pro y Pack Pro tiran del mismo stock, así que
//     el carrito se comprueba agregado, no línea a línea;
//   · lo vendido y no descontado en HWToolbox reserva, y la salida registrada
//     libera exactamente su parte (no todo el pedido);
//   · los admins no tienen tope; un inventario caído bloquea al resto;
//   · quitar unidades siempre se puede, aunque el carrito no cuadre.
// =============================================================

import { describe, it, expect } from 'vitest'
import type { ProductCategory } from '@/types/database'
import {
  allocateStock,
  clampToStock,
  computePools,
  demandByPool,
  supplierNote,
  guardStockChange,
  productHeadroom,
  productStockState,
  stockBadge,
  stockLook,
  validateStock,
  type StockLine,
  type StockView,
} from '@/lib/stock/compute'

const p = (code: string, category: ProductCategory = 'tpv') => ({
  code,
  category,
  name: code,
})

const tpvPro = p('tpv-pro')
const packPro = p('pack-pro', 'pack')
const cajon = p('cajon', 'accessory')
const sensor = p('sensor-temperatura', 'accessory') // sin componentes
const implPro = p('implementacion-pro', 'service')

const COMPONENTS: StockView['components'] = {
  'tpv-pro': [{ pool: 'tpv-pro', qty: 1 }],
  'pack-pro': [
    { pool: 'tpv-pro', qty: 1 },
    { pool: 'cajon', qty: 1 },
    { pool: 'printer-wifi', qty: 1 },
  ],
  cajon: [{ pool: 'cajon', qty: 1 }],
}

function view(over: Partial<StockView> = {}): StockView {
  return {
    status: 'ok',
    bypass: false,
    pools: { 'tpv-pro': 3, cajon: 10, 'printer-wifi': 2 },
    components: COMPONENTS,
    ...over,
  }
}

const L = (product: StockLine['product'], qty: number): StockLine => ({ product, qty })

describe('demandByPool', () => {
  it('suma por pool los componentes de cada producto', () => {
    const d = demandByPool([L(packPro, 2), L(tpvPro, 1), L(implPro, 1)], view())
    expect(d.get('tpv-pro')).toBe(3)
    expect(d.get('cajon')).toBe(2)
    expect(d.get('printer-wifi')).toBe(2)
  })

  it('respeta la cantidad por unidad (2 impresoras por pack)', () => {
    const v = view({ components: { premium: [{ pool: 'printer-wifi', qty: 2 }] } })
    expect(demandByPool([L(p('premium', 'pack'), 3)], v).get('printer-wifi')).toBe(6)
  })
})

describe('productHeadroom', () => {
  it('es el mínimo entre sus pools', () => {
    // pack-pro: tpv 3, cajón 10, impresora wifi 2 -> 2
    expect(productHeadroom(packPro, new Map(), view())).toBe(2)
  })

  it('descuenta lo que ya pide el carrito en pools compartidos', () => {
    expect(productHeadroom(packPro, new Map([['tpv-pro', 2]]), view())).toBe(1)
  })

  it('sin control de stock no tiene tope', () => {
    expect(productHeadroom(implPro, new Map(), view())).toBe(Infinity)
  })

  it('producto físico sin componentes = 0', () => {
    expect(productHeadroom(sensor, new Map(), view())).toBe(0)
  })

  it('inventario caído = 0 para los controlados', () => {
    expect(productHeadroom(tpvPro, new Map(), view({ status: 'unavailable' }))).toBe(0)
  })
})

describe('validateStock', () => {
  it('acepta un carrito que cabe', () => {
    expect(validateStock([L(tpvPro, 1), L(packPro, 2)], view())).toEqual({ ok: true })
  })

  it('rechaza cuando dos productos agotan un pool compartido', () => {
    // 2 TPV Pro + 2 Pack Pro = 4 TPV con 3 pedibles
    const r = validateStock([L(tpvPro, 2), L(packPro, 2)], view())
    expect(r.ok).toBe(false)
  })

  it('suma las líneas repetidas de un mismo producto (tablet regalo + de pago)', () => {
    const r = validateStock([L(tpvPro, 2), L(tpvPro, 2)], view())
    expect(r).toEqual({
      ok: false,
      error: 'Solo quedan 3 de «tpv-pro» para este pedido (has pedido 4).',
    })
  })

  it('dice "sin stock" cuando no queda nada', () => {
    const r = validateStock([L(tpvPro, 1)], view({ pools: { 'tpv-pro': 0 } }))
    expect(r).toEqual({ ok: false, error: '«tpv-pro» está sin stock.' })
  })

  it('bloquea un producto físico sin mapeo', () => {
    const r = validateStock([L(sensor, 1)], view())
    expect(r).toEqual({
      ok: false,
      error: '«sensor-temperatura» no tiene stock registrado en el almacén.',
    })
  })

  it('los servicios nunca se bloquean, ni con el inventario caído', () => {
    expect(validateStock([L(implPro, 5)], view({ status: 'unavailable' }))).toEqual({
      ok: true,
    })
  })

  it('inventario caído bloquea los controlados', () => {
    const r = validateStock([L(tpvPro, 1)], view({ status: 'unavailable' }))
    expect(r.ok).toBe(false)
  })

  it('admin: sin tope, aunque no haya stock ni inventario', () => {
    const v = view({ bypass: true, status: 'unavailable', pools: {} })
    expect(validateStock([L(tpvPro, 50), L(sensor, 3)], v)).toEqual({ ok: true })
  })
})

describe('guardStockChange', () => {
  it('deja quitar unidades aunque el carrito siga sin cuadrar', () => {
    const v = view({ pools: { 'tpv-pro': 1 } })
    expect(guardStockChange([L(tpvPro, 3)], [L(tpvPro, 2)], v)).toEqual({ ok: true })
  })

  it('rechaza subir por encima de lo pedible', () => {
    const r = guardStockChange([L(tpvPro, 3)], [L(tpvPro, 4)], view())
    expect(r.ok).toBe(false)
  })

  it('deja subir mientras quepa', () => {
    expect(guardStockChange([L(tpvPro, 1)], [L(tpvPro, 2)], view())).toEqual({ ok: true })
  })
})

describe('productStockState / stockBadge', () => {
  it('el tope cuenta lo que ya está en el carrito', () => {
    const s = productStockState(tpvPro, [L(tpvPro, 1), L(packPro, 1)], view())
    // 3 pedibles, el pack se lleva 1, hay 1 TPV: puede llegar a 2
    expect(s.maxQty).toBe(2)
    expect(s.available).toBe(3)
  })

  it('admin: tope infinito pero sigue viendo el stock', () => {
    const s = productStockState(tpvPro, [], view({ bypass: true, pools: { 'tpv-pro': 0 } }))
    expect(s.maxQty).toBe(Infinity)
    expect(stockBadge(s)).toBe('Sin stock')
  })

  it('avisa cuando quedan pocas y calla cuando sobran', () => {
    expect(stockBadge(productStockState(tpvPro, [], view()))).toBe('Quedan 3')
    expect(stockBadge(productStockState(cajon, [], view()))).toBeNull()
    expect(stockBadge(productStockState(implPro, [], view()))).toBeNull()
  })

  it('inventario caído: "Stock sin comprobar"', () => {
    const s = productStockState(tpvPro, [], view({ status: 'unavailable' }))
    expect(stockBadge(s)).toBe('Stock sin comprobar')
    expect(s.maxQty).toBe(0)
  })
})

describe('stockLook', () => {
  it('sin stock y fuera del carrito: bloqueada, "No disponible"', () => {
    const s = productStockState(tpvPro, [], view({ pools: { 'tpv-pro': 0 } }))
    expect(stockLook(s, 0)).toEqual({ blocked: true, blockedLabel: 'No disponible', low: false })
  })

  it('si ya está en el carrito no se bloquea: tiene que poder quitarse', () => {
    const s = productStockState(tpvPro, [L(tpvPro, 3)], view())
    expect(stockLook(s, 3).blocked).toBe(false)
  })

  it('hay stock pero el resto del pedido se lo lleva', () => {
    // 3 TPV Pro pedibles y el carrito ya tiene 3 TPV sueltos: el Pack Pro
    // (que también lleva TPV Pro) se queda sin hueco, aunque por sí solo
    // tendría 2 (lo limita la impresora WiFi).
    const s = productStockState(packPro, [L(tpvPro, 3)], view())
    expect(stockLook(s, 0)).toEqual({
      blocked: true,
      blockedLabel: 'Agotado en este pedido',
      low: true,
    })
  })

  it('admin: nunca bloqueada', () => {
    const s = productStockState(tpvPro, [], view({ bypass: true, pools: { 'tpv-pro': 0 } }))
    expect(stockLook(s, 0).blocked).toBe(false)
  })

  it('marca "quedan pocas" con 3 o menos', () => {
    expect(stockLook(productStockState(tpvPro, [], view()), 0).low).toBe(true)
    expect(
      stockLook(productStockState(tpvPro, [], view({ pools: { 'tpv-pro': 4 } })), 0).low,
    ).toBe(false)
  })

  it('servicios: ni bloqueo ni aviso', () => {
    expect(stockLook(productStockState(implPro, [], view()), 0)).toEqual({
      blocked: false,
      blockedLabel: null,
      low: false,
    })
  })
})

describe('productos con proveedor', () => {
  // Pack con proveedor que comparte TPV Pro con el TPV suelto (sin proveedor).
  const packProv = { ...p('pack-prov', 'pack'), supplier_fallback: true }
  const sensorProv = { ...p('sensor-prov', 'accessory'), supplier_fallback: true }
  const v = view({
    components: { ...COMPONENTS, 'pack-prov': [{ pool: 'tpv-pro', qty: 1 }] },
  })

  it('nunca bloquean, ni sin stock ni sin artículo', () => {
    const empty = view({ pools: { 'tpv-pro': 0 }, components: v.components })
    expect(validateStock([L(packProv, 5), L(sensorProv, 2)], empty)).toEqual({ ok: true })
    const s = productStockState(packProv, [], empty)
    expect(s.maxQty).toBe(Infinity)
    expect(stockBadge(s)).toBe('A proveedor')
    expect(stockLook(s, 0).blocked).toBe(false)
  })

  it('no le quitan stock a los productos sin proveedor', () => {
    // 3 TPV pedibles: el pack con proveedor cede y los 3 TPV sueltos caben.
    expect(validateStock([L(packProv, 3), L(tpvPro, 3)], v)).toEqual({ ok: true })
    expect(productStockState(tpvPro, [L(packProv, 3)], v).maxQty).toBe(3)
  })

  it('subir un producto con proveedor no lo frena la guarda', () => {
    expect(guardStockChange([L(packProv, 1)], [L(packProv, 9)], v)).toEqual({ ok: true })
  })

  it('se sirve primero del almacén y lo que falta va a proveedor', () => {
    // 3 TPV pedibles, 1 TPV suelto (prioritario) -> quedan 2 para el pack de 5.
    const a = allocateStock([L(packProv, 5), L(tpvPro, 1)], v)
    expect(a[0]).toEqual({ fromStock: 2, fromSupplier: 3, unknown: false })
    expect(a[1]).toEqual({ fromStock: 1, fromSupplier: 0, unknown: false })
  })

  it('sin artículo en el almacén: todo a proveedor', () => {
    expect(allocateStock([L(sensorProv, 2)], v)[0]).toEqual({
      fromStock: 0,
      fromSupplier: 2,
      unknown: false,
    })
  })

  it('dos líneas con proveedor se reparten el stock en orden', () => {
    const a = allocateStock([L(packProv, 2), L(packProv, 2)], v)
    expect(a.map((x) => x.fromSupplier)).toEqual([0, 1])
  })

  it('inventario caído: no se sabe, se marca para confirmar', () => {
    const a = allocateStock([L(packProv, 2)], { ...v, status: 'unavailable' })
    expect(a[0]).toEqual({ fromStock: 2, fromSupplier: 0, unknown: true })
    expect(supplierNote(a[0], 2)).toMatch(/confirmar/)
  })

  it('notas para quien prepara el pedido', () => {
    expect(supplierNote({ fromStock: 2, fromSupplier: 0, unknown: false }, 2)).toBeNull()
    expect(supplierNote({ fromStock: 0, fromSupplier: 2, unknown: false }, 2)).toBe(
      'A pedir a proveedor: sin stock en almacén.',
    )
    expect(supplierNote({ fromStock: 1, fromSupplier: 2, unknown: false }, 3)).toBe(
      'A pedir a proveedor: 2 de 3 ud. (sin stock suficiente en almacén).',
    )
  })
})

describe('Canarias: siempre a proveedor', () => {
  // Aunque tenga componentes (y haya stock), un SKU canario no tira del almacén.
  const tpvCanarias = { ...p('tpv-pro-canarias'), region: 'canarias' as const }
  const v = view({
    components: { ...COMPONENTS, 'tpv-pro-canarias': [{ pool: 'tpv-pro', qty: 1 }] },
  })

  it('nunca bloquea y no tiene tope', () => {
    expect(validateStock([L(tpvCanarias, 20)], view({ pools: {} }))).toEqual({ ok: true })
    const s = productStockState(tpvCanarias, [], v)
    expect(s.maxQty).toBe(Infinity)
    expect(stockBadge(s)).toBe('A proveedor')
  })

  it('todo a proveedor, aunque haya stock y aunque el inventario esté caído', () => {
    expect(allocateStock([L(tpvCanarias, 2)], v)[0]).toEqual({
      fromStock: 0,
      fromSupplier: 2,
      unknown: false,
    })
    expect(allocateStock([L(tpvCanarias, 2)], { ...v, status: 'unavailable' })[0].fromStock).toBe(0)
  })

  it('no le quita stock a los peninsulares', () => {
    expect(productStockState(tpvPro, [L(tpvCanarias, 5)], v).maxQty).toBe(3)
  })

  it('su nota dice Canarias y proveedor', () => {
    const a = allocateStock([L(tpvCanarias, 1)], v)[0]
    expect(supplierNote(a, 1, tpvCanarias)).toBe(
      'Canarias: pedir a proveedor, no sale de nuestro almacén.',
    )
  })
})

describe('clampToStock (puente /catalogo → wizard)', () => {
  const packProv = { ...p('pack-prov', 'pack'), supplier_fallback: true }
  const sensorProv = { ...p('sensor-prov', 'accessory'), supplier_fallback: true }
  const tpvCanarias = { ...p('tpv-pro-canarias'), region: 'canarias' as const }
  const v = view({
    components: { ...COMPONENTS, 'pack-prov': [{ pool: 'tpv-pro', qty: 1 }] },
  })
  const empty = view({ pools: { 'tpv-pro': 0 }, components: v.components })

  it('los productos con proveedor entran enteros aunque no haya stock', () => {
    expect(clampToStock(packProv, 4, [], empty)).toBe(4)
    expect(clampToStock(sensorProv, 2, [], v)).toBe(2) // sin artículo
    expect(clampToStock(tpvCanarias, 3, [], empty)).toBe(3)
  })

  it('los de almacén se recortan a lo pedible', () => {
    expect(clampToStock(tpvPro, 5, [], v)).toBe(3)
    expect(clampToStock(tpvPro, 2, [], empty)).toBe(0)
  })

  it('descuenta las líneas de almacén del carrito, no las de proveedor', () => {
    expect(clampToStock(tpvPro, 5, [L(packPro, 2)], v)).toBe(1)
    expect(clampToStock(tpvPro, 3, [L(packProv, 3)], v)).toBe(3)
  })

  it('inventario caído: almacén a 0, proveedor entero', () => {
    const down = { ...v, status: 'unavailable' as const }
    expect(clampToStock(tpvPro, 2, [], down)).toBe(0)
    expect(clampToStock(packProv, 2, [], down)).toBe(2)
  })

  it('admin y servicios: sin recorte', () => {
    expect(clampToStock(tpvPro, 9, [], view({ bypass: true, pools: {} }))).toBe(9)
    expect(clampToStock(implPro, 2, [], empty)).toBe(2)
  })
})

describe('computePools', () => {
  const pools = [
    { key: 'tpv-pro', label: 'TPV Pro', article_ids: ['a-10pos', 'a-aqprox'] },
    { key: 'cajon', label: 'Cajón', article_ids: ['a-cajon'] },
  ]
  const components = [
    { product_code: 'tpv-pro', pool_key: 'tpv-pro', quantity: 1 },
    { product_code: 'pack-pro', pool_key: 'tpv-pro', quantity: 1 },
    { product_code: 'pack-pro', pool_key: 'cajon', quantity: 1 },
  ]
  const availableByArticle = new Map([
    ['a-10pos', 4],
    ['a-aqprox', 2],
    ['a-cajon', 9],
  ])

  it('disponible = suma de los artículos del pool', () => {
    const r = computePools({ pools, components, availableByArticle, commitments: [], exits: [] })
    expect(r.pools.find((x) => x.key === 'tpv-pro')).toMatchObject({
      available: 6,
      committed: 0,
      orderable: 6,
    })
  })

  it('los pedidos abiertos reservan todo lo que piden', () => {
    const r = computePools({
      pools,
      components,
      availableByArticle,
      commitments: [
        { operation_id: 'HW-1', status: 'pendiente', product_code: 'pack-pro', qty: 2 },
        { operation_id: 'HW-2', status: 'nuevo', product_code: 'tpv-pro', qty: 1 },
      ],
      exits: [],
    })
    expect(r.pools.find((x) => x.key === 'tpv-pro')?.orderable).toBe(3)
    expect(r.pools.find((x) => x.key === 'cajon')?.orderable).toBe(7)
    expect(r.pendingExits).toEqual([])
  })

  it('una salida registrada libera solo su parte, por artículo del pool', () => {
    const r = computePools({
      pools,
      components,
      availableByArticle,
      commitments: [
        { operation_id: 'HW-3', status: 'enviado', product_code: 'pack-pro', qty: 2 },
      ],
      // Salió un TPV Aqprox y los 2 cajones; queda 1 TPV por registrar.
      exits: [
        { mainops_operation_id: 'HW-3', article_id: 'a-aqprox', unidades: 1 },
        { mainops_operation_id: 'HW-3', article_id: 'a-cajon', unidades: 2 },
      ],
    })
    expect(r.pools.find((x) => x.key === 'tpv-pro')?.committed).toBe(1)
    expect(r.pools.find((x) => x.key === 'cajon')?.committed).toBe(0)
    expect(r.pendingExits).toEqual([{ operation_id: 'HW-3', units: 1 }])
  })

  it('salidas de más no generan reserva negativa', () => {
    const r = computePools({
      pools,
      components,
      availableByArticle,
      commitments: [{ operation_id: 'HW-4', status: 'enviado', product_code: 'tpv-pro', qty: 1 }],
      exits: [{ mainops_operation_id: 'HW-4', article_id: 'a-10pos', unidades: 3 }],
    })
    expect(r.pools.find((x) => x.key === 'tpv-pro')?.committed).toBe(0)
  })

  it('agrupa los componentes por producto', () => {
    const r = computePools({ pools, components, availableByArticle, commitments: [], exits: [] })
    expect(r.components['pack-pro']).toEqual([
      { pool: 'tpv-pro', qty: 1 },
      { pool: 'cajon', qty: 1 },
    ])
  })
})
