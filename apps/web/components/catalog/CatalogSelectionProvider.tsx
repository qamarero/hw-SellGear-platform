'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Product } from '@/types/database'
import { MAX_PICKS, MAX_QTY, type CatalogPick } from '@/lib/catalog/order-link'
import { isFreePrice } from '@/lib/product-rules'
import {
  guardStockChange,
  productStockState,
  type ProductRef,
  type ProductStockState,
  type StockLine,
  type StockView,
} from '@/lib/stock/compute'
import StockNotice from '@/components/orders/StockNotice'

/**
 * Selección dentro de /catalogo, antes de saltar al wizard.
 *
 * Se guarda en sessionStorage para no perderla al entrar en una ficha y
 * volver — NO en localStorage: es un borrador de pedido de una sesión de
 * trabajo, no una preferencia del usuario. El traspaso al wizard va por URL
 * (lib/catalog/order-link.ts), no por aquí.
 *
 * La clave es el `code`, no el UUID: es lo que viaja en la URL y lo que
 * sobrevive a un redespliegue.
 */
const STORAGE_KEY = 'hw-catalog-picks'

interface SelectionContextValue {
  picks: Map<string, number>
  totalUnits: number
  add: (product: Product) => void
  inc: (product: Product) => void
  dec: (product: Product) => void
  clear: () => void
  qtyOf: (code: string) => number
  asPicks: () => CatalogPick[]
  /** Stock de un producto contando la selección (undefined sin datos). */
  stockOf: (product: Product) => ProductStockState | undefined
}

const SelectionContext = createContext<SelectionContextValue | null>(null)

function readStored(): Map<string, number> {
  if (typeof window === 'undefined') return new Map()
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return new Map()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Map()
    const map = new Map<string, number>()
    for (const entry of parsed) {
      if (
        Array.isArray(entry) &&
        typeof entry[0] === 'string' &&
        Number.isInteger(entry[1]) &&
        entry[1] >= 1
      ) {
        map.set(entry[0], Math.min(MAX_QTY, entry[1]))
      }
      if (map.size >= MAX_PICKS) break
    }
    return map
  } catch {
    // sessionStorage bloqueado (Safari privado) o JSON corrupto: seguimos en
    // memoria en vez de romper la página.
    return new Map()
  }
}

interface CatalogSelectionProviderProps {
  children: ReactNode
  /** Stock del usuario, calculado en el layout (lib/stock). */
  stock?: StockView | null
  /** code → categoría y nombre: la selección guarda solo `code`. */
  catalog?: ProductRef[]
}

export function CatalogSelectionProvider({
  children,
  stock = null,
  catalog = [],
}: CatalogSelectionProviderProps) {
  // Primer render siempre vacío, para no provocar mismatch de hidratación.
  const [picks, setPicks] = useState<Map<string, number>>(new Map())
  const [notice, setNotice] = useState<string | null>(null)

  const refByCode = useMemo(
    () => new Map(catalog.map((r) => [r.code, r])),
    [catalog],
  )
  const toLines = useCallback(
    (map: Map<string, number>): StockLine[] =>
      [...map].flatMap(([code, qty]) => {
        const product = refByCode.get(code)
        return product ? [{ product, qty }] : []
      }),
    [refByCode],
  )

  useEffect(() => {
    const stored = readStored()
    if (stored.size) setPicks(stored)
  }, [])

  const commit = useCallback((next: Map<string, number>) => {
    setPicks(next)
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
    } catch {
      // Sin persistencia, pero la selección sigue viva en memoria.
    }
  }, [])

  /**
   * Como commit, pero no deja sumar unidades por encima de lo pedible (salvo
   * admins). Quitar va siempre por commit: se puede aunque no cuadre.
   */
  const commitWithinStock = useCallback(
    (next: Map<string, number>) => {
      if (stock) {
        const check = guardStockChange(toLines(picks), toLines(next), stock)
        if (!check.ok) {
          setNotice(check.error)
          return
        }
      }
      setNotice(null)
      commit(next)
    },
    [stock, picks, toLines, commit],
  )

  const add = useCallback(
    (product: Product) => {
      const next = new Map(picks)
      if (next.size >= MAX_PICKS && !next.has(product.code)) return
      // Los productos de precio libre se acuerdan uno a uno en el pedido:
      // acumular unidades aquí no significaría nada.
      const step = isFreePrice(product) ? 0 : 1
      const current = next.get(product.code) ?? 0
      next.set(product.code, Math.min(MAX_QTY, current + (current ? step : 1)))
      commitWithinStock(next)
    },
    [picks, commitWithinStock],
  )

  const inc = useCallback(
    (product: Product) => {
      if (isFreePrice(product)) return
      const next = new Map(picks)
      const current = next.get(product.code) ?? 0
      next.set(product.code, Math.min(MAX_QTY, current + 1))
      commitWithinStock(next)
    },
    [picks, commitWithinStock],
  )

  const dec = useCallback(
    (product: Product) => {
      const next = new Map(picks)
      const current = next.get(product.code) ?? 0
      if (current <= 1 || isFreePrice(product)) next.delete(product.code)
      else next.set(product.code, current - 1)
      commit(next)
    },
    [picks, commit],
  )

  const clear = useCallback(() => commit(new Map()), [commit])

  const value = useMemo<SelectionContextValue>(
    () => ({
      picks,
      totalUnits: [...picks.values()].reduce((a, b) => a + b, 0),
      add,
      inc,
      dec,
      clear,
      qtyOf: (code: string) => picks.get(code) ?? 0,
      asPicks: () => [...picks].map(([code, qty]) => ({ code, qty })),
      stockOf: (product: Product) =>
        stock ? productStockState(product, toLines(picks), stock) : undefined,
    }),
    [picks, add, inc, dec, clear, stock, toLines],
  )

  return (
    <SelectionContext.Provider value={value}>
      {children}
      <StockNotice message={notice} onClose={() => setNotice(null)} />
    </SelectionContext.Provider>
  )
}

export function useCatalogSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext)
  if (!ctx) {
    throw new Error(
      'useCatalogSelection debe usarse dentro de CatalogSelectionProvider',
    )
  }
  return ctx
}
