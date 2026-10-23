import { cn } from '@/lib/utils'
import { PICKUP_STATUS_COLORS, PICKUP_STATUS_LABELS } from '@/lib/pickups/status'
import type { PickupStatus } from '@/types/database'

interface PickupStatusBadgeProps {
  status: PickupStatus
  /** Sustituye la etiqueta, p. ej. «Incidencia · Ausente». */
  label?: string
  className?: string
}

export default function PickupStatusBadge({ status, label, className }: PickupStatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        PICKUP_STATUS_COLORS[status],
        className,
      )}
    >
      {label ?? PICKUP_STATUS_LABELS[status]}
    </span>
  )
}
