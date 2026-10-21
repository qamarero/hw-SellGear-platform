// =============================================================
// Planes de financiación de hardware.
//
// Solo 4 productos del catálogo son financiables (los mismos que en el
// catálogo web). Cada uno tiene un plan de 3 pagos. Los importes son BASE
// (s/IVA) en céntimos; la UI y el servidor les suman IVA (21 % peninsular,
// 0 % Canarias, misma regla que el resto vía isCanaryIslands).
//
// Las bases se eligen para que cada plazo CON IVA dé la cifra comercial
// (p.ej. 249,90) y, a la vez, que la suma de plazos coincida al céntimo con
// el total del pedido (IVA sobre la base total). Las dos cosas no siempre
// caben: en KDS Pro la entrada es 514,89 y no 514,90, decisión de negocio
// del 2026-10-21 para que todo cuadre.
//
// Decisión de negocio (2026-05-27): financiar es más caro que pagar al
// contado. El total del plan REEMPLAZA al precio de catálogo en los
// pedidos de tipo 'hardware_financiacion'. Un pedido de financiación es
// siempre 1 único producto financiable, cantidad 1, sin descuento.
// =============================================================

import { lineVatCents } from '@/lib/pricing'

/** Importes BASE (s/IVA) por etapa, en céntimos. [entrada, plazo2, plazo3]. */
export const FINANCING_PLANS = {
  // 605 + 272,25 + 272,25 = 1.149,50 con IVA
  'pack-pro': [50000, 22500, 22500],
  // 845,79 + 423,50 + 423,50 = 1.692,79 con IVA
  'pack-premium': [69900, 35000, 35000],
  // KDS Pro (693 € contado): 514,89 + 249,90 + 249,90 = 1.014,69 con IVA
  'kds-pro': [42553, 20653, 20653],
  // KDS Premium (963 € contado): 714,90 + 347,90 + 347,90 = 1.410,70 con IVA
  'kds-premium': [59083, 28752, 28752],
} as const satisfies Record<string, readonly [number, number, number]>

export type FinanceableCode = keyof typeof FINANCING_PLANS

export const FINANCEABLE_CODES: readonly string[] = Object.keys(FINANCING_PLANS)

/**
 * Cómo se nombran en pantalla y en errores. Una sola cadena: antes estaba
 * escrita a mano en el wizard, en POST /api/orders y en FinancingCatalog, y
 * al cambiar la gama se habría quedado vieja en alguno.
 */
export const FINANCEABLE_LABEL = 'Pack Pro, Pack Premium, KDS Pro y KDS Premium'

export function isFinanceableCode(code: string): code is FinanceableCode {
  return code in FINANCING_PLANS
}

/** Devuelve [entrada, plazo2, plazo3] en céntimos base, o null si no es financiable. */
export function financingPlanBaseCents(
  code: string,
): readonly [number, number, number] | null {
  return isFinanceableCode(code) ? FINANCING_PLANS[code] : null
}

/** Suma de las 3 etapas (precio base s/IVA del producto financiado). */
export function financingBaseTotalCents(code: string): number | null {
  const plan = financingPlanBaseCents(code)
  if (!plan) return null
  return plan[0] + plan[1] + plan[2]
}

export interface FinancingInstallment {
  stage: 1 | 2 | 3
  baseCents: number
  vatCents: number
  grossCents: number
}

/**
 * Plazos con IVA aplicado, a la tasa dada (21 peninsular, 0 Canarias).
 * grossCents = lo que transfiere el cliente en ese plazo.
 *
 * La suma de grossCents coincide al céntimo con cartTotals() sobre la
 * línea única (precio = base total) porque reutilizamos lineVatCents
 * (mismo redondeo por etapa que el cálculo del total). Verificado para
 * los 3 productos a 21 % y a 0 %.
 */
export function financingInstallments(
  code: string,
  vatRate: number,
): FinancingInstallment[] | null {
  const plan = financingPlanBaseCents(code)
  if (!plan) return null
  return plan.map((baseCents, i) => {
    // qty=1, discount=0 → lineVatCents(base, 1, 0, vat) = round(base * vat/100)
    const vatCents = lineVatCents(baseCents, 1, 0, vatRate)
    return {
      stage: (i + 1) as 1 | 2 | 3,
      baseCents,
      vatCents,
      grossCents: baseCents + vatCents,
    }
  })
}
