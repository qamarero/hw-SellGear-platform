// =============================================================
// Consultas del catálogo para Server Components.
//
// Las páginas de /catalogo son Server Components, así que leen products
// directamente por Supabase en vez de pasar por /api/products (que existe
// para el wizard y el modal, que son cliente).
// =============================================================

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { Product } from '@/types/database'

/**
 * Catálogo activo, en orden comercial.
 *
 * Ordena SOLO por sort_order: las bandas de 100 por pestaña (Packs 100,
 * TPV 200, … Canarias 800) ya producen el orden correcto. Ordenar antes por
 * `category` lo rompería, porque es TEXT y se ordena alfabéticamente.
 *
 * Con `cache`: el layout de /catalogo también lo necesita (para el stock de
 * la selección) y así layout y página comparten una sola lectura por render.
 */
export const getCatalog = cache(async function getCatalog(): Promise<Product[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true })

  if (error) throw new Error(`No se pudo cargar el catálogo: ${error.message}`)
  return (data ?? []) as Product[]
})

/** Un producto por `code` (la clave de las URLs). Null si no existe o está inactivo. */
export async function getCatalogProduct(code: string): Promise<Product | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('code', code)
    .eq('active', true)
    .maybeSingle()

  if (error) return null
  return (data as Product) ?? null
}
