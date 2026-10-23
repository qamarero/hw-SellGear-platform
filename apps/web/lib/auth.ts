import type { UserRole } from '@/types/database'

/** Emails con acceso admin hardcoded (fallback si el rol aún no está asignado en BD) */
const ADMIN_EMAILS = [
  'jj.gallego@qamarero.com',
  'domingo.bueno@qamarero.com',
]

export function isAdminUser(email?: string | null, role?: UserRole | null): boolean {
  if (role === 'admin') return true
  if (email && ADMIN_EMAILS.includes(email.toLowerCase())) return true
  return false
}

// Capacidades derivadas de la matriz roles × permisos.
// Mantén estos helpers como única fuente de verdad: si la matriz cambia,
// se cambia aquí y todos los call sites quedan alineados.

export function canCreateOrder(role: UserRole | null | undefined): boolean {
  return !!role && (['commercial', 'hardware', 'admin'] as UserRole[]).includes(role)
}

export function canEditOrder(role: UserRole | null | undefined): boolean {
  return !!role && (['hardware', 'manager', 'admin'] as UserRole[]).includes(role)
}

export function canCreateShipment(role: UserRole | null | undefined): boolean {
  return !!role && (['hardware', 'admin'] as UserRole[]).includes(role)
}

export function canDeleteShipment(role: UserRole | null | undefined): boolean {
  return role === 'admin'
}

export function canDeleteOrder(role: UserRole | null | undefined): boolean {
  return role === 'admin'
}

export function canExport(role: UserRole | null | undefined): boolean {
  return !!role && (['hardware', 'manager', 'admin'] as UserRole[]).includes(role)
}

export function canRefreshTracking(role: UserRole | null | undefined): boolean {
  return !!role && role !== 'viewer'
}

export function canComment(role: UserRole | null | undefined): boolean {
  return !!role && role !== 'viewer'
}

// ===== Agenda de direcciones (address_book) =====

export function canReadAddressBook(role: UserRole | null | undefined): boolean {
  return !!role
}

export function canCreateAddressBook(role: UserRole | null | undefined): boolean {
  return !!role && (['hardware', 'admin'] as UserRole[]).includes(role)
}

export function canEditAddressBook(role: UserRole | null | undefined): boolean {
  return canCreateAddressBook(role)
}

export function canDeleteAddressBook(role: UserRole | null | undefined): boolean {
  return canCreateAddressBook(role)
}

// ===== Envios libres (tabla shipments, sin order_id) =====

export function canReadFreeShipments(role: UserRole | null | undefined): boolean {
  return !!role
}

export function canCreateFreeShipment(role: UserRole | null | undefined): boolean {
  return !!role && (['hardware', 'admin'] as UserRole[]).includes(role)
}

/** Programar, anular y dar de alta recogidas TIPSA: los mismos que crean envios. */
export function canManagePickups(role: UserRole | null | undefined): boolean {
  return canCreateFreeShipment(role)
}

export function canDeleteFreeShipment(role: UserRole | null | undefined): boolean {
  return role === 'admin'
}
