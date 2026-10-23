'use client'

import { useEffect, useState, useRef } from 'react'
import type { AddressBookEntry } from '@/types/database'

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand'

export interface AddressPickerProps {
  open: boolean
  onClose: () => void
  onSelect: (entry: AddressBookEntry) => void
  variant?: 'sender' | 'recipient' | 'pickup' | 'sat'
}

const PLACEHOLDER: Record<NonNullable<AddressPickerProps['variant']>, string> = {
  sender: 'Buscar remitente en agenda...',
  recipient: 'Buscar destinatario en agenda...',
  pickup: 'Buscar cliente en agenda...',
  sat: 'Buscar SAT en agenda...',
}

const MAX_RESULTS = 10

export default function AddressPicker({
  open,
  onClose,
  onSelect,
  variant = 'recipient',
}: AddressPickerProps) {
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [entries, setEntries] = useState<AddressBookEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset al abrir.
  useEffect(() => {
    if (open) {
      setQ('')
      setDebouncedQ('')
      setEntries([])
      setError(null)
      // Focus al input cuando abre.
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Debounce 250ms.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    if (!open) return
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ limit: String(MAX_RESULTS) })
        if (debouncedQ) params.set('q', debouncedQ)
        const res = await fetch(`/api/address-book?${params.toString()}`, {
          cache: 'no-store',
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'Error al buscar')
        if (!cancelled) setEntries(body.entries ?? [])
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Error desconocido')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [debouncedQ, open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-3">
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={PLACEHOLDER[variant]}
            className={inputClass}
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-100"
          >
            Cerrar
          </button>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200 mb-3">
            {error}
          </div>
        )}

        <div className="max-h-80 overflow-y-auto">
          {loading && entries.length === 0 ? (
            <p className="text-center py-6 text-sm text-gray-400">Buscando...</p>
          ) : entries.length === 0 ? (
            <p className="text-center py-6 text-sm text-gray-400">
              {debouncedQ ? 'Sin resultados' : 'Empieza a teclear para buscar'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(entry)
                      onClose()
                    }}
                    className="w-full text-left px-3 py-2.5 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    <div className="font-medium text-gray-900 text-sm">{entry.name}</div>
                    {entry.venue_name && (
                      <div className="text-xs text-gray-500">{entry.venue_name}</div>
                    )}
                    <div className="text-xs text-gray-400">
                      {entry.address} · {entry.cp} {entry.city}
                      {entry.province ? ` (${entry.province})` : ''}
                    </div>
                    {entry.alias && (
                      <div className="text-[11px] text-gray-400 italic mt-0.5">
                        {entry.alias}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
