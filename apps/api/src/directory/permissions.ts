import type { AppName, Role } from '../db/types';

export interface ActorView {
  userId: string;
  roles: Array<{ role: Role; scope: string[] | null }>;
}

export interface Scope {
  all: boolean;
  divisions: Set<string>;
}

/** Cakupan pengelolaan akun: divisi mana yang boleh dikelola aktor. */
export function managementScope(a: ActorView): Scope {
  const s: Scope = { all: false, divisions: new Set() };
  for (const r of a.roles) {
    if (r.role === 'OWNER') s.all = true;
    if (r.role === 'ACCOUNT_ADMIN' || r.role === 'HR') {
      if (r.scope === null) {
        if (r.role === 'ACCOUNT_ADMIN') s.all = true;
        else s.all = true; // HR tanpa batas divisi
      } else r.scope.forEach((d) => s.divisions.add(d));
    }
  }
  return s;
}

export function hasRole(a: ActorView, ...roles: Role[]): boolean {
  return a.roles.some((r) => roles.includes(r.role));
}

export function inScope(scope: Scope, division: string): boolean {
  return scope.all || scope.divisions.has(division);
}

export function canManageAccounts(a: ActorView): boolean {
  return hasRole(a, 'OWNER', 'ACCOUNT_ADMIN', 'HR');
}

export function canManageDivision(a: ActorView, division: string): boolean {
  return inScope(managementScope(a), division);
}

/** Aplikasi mana yang boleh diberikan/dicabut aktor untuk karyawan pada divisi tertentu. */
export function canGrantApp(a: ActorView, app: AppName, division: string): boolean {
  if (!canManageDivision(a, division)) return false;
  if (app === 'CHAT') return hasRole(a, 'OWNER', 'ACCOUNT_ADMIN', 'HR');
  if (app === 'WORK') return hasRole(a, 'OWNER', 'ACCOUNT_ADMIN');
  return false;
}

/**
 * Role yang boleh ditetapkan aktor, beserta batas cakupan.
 * - OWNER: semua role, cakupan bebas.
 * - ACCOUNT_ADMIN: HR/APPROVER/EMPLOYEE, cakupan harus di dalam cakupannya sendiri. Tidak boleh OWNER/ACCOUNT_ADMIN.
 * - HR: APPROVER/EMPLOYEE, cakupan di dalam cakupannya.
 */
export function canAssignRole(a: ActorView, role: Role, scope: string[] | null, targetDivision: string): boolean {
  if (!canManageDivision(a, targetDivision)) return false;
  if (hasRole(a, 'OWNER')) return true;
  const mine = managementScope(a);
  const requested = scope === null ? null : scope;
  const withinMine = requested === null ? mine.all : requested.every((d) => inScope(mine, d));
  if (!withinMine) return false;
  if (hasRole(a, 'ACCOUNT_ADMIN')) return ['HR', 'APPROVER', 'EMPLOYEE'].includes(role);
  if (hasRole(a, 'HR')) return ['APPROVER', 'EMPLOYEE'].includes(role);
  return false;
}

export function canRevokeRole(a: ActorView, role: Role, targetDivision: string): boolean {
  return canAssignRole(a, role, null, targetDivision) || (hasRole(a, 'OWNER') && canManageDivision(a, targetDivision));
}

export function canDisableAccount(a: ActorView, targetDivision: string, targetRoles: Role[]): boolean {
  if (!canManageDivision(a, targetDivision)) return false;
  if (targetRoles.includes('OWNER') || targetRoles.includes('ACCOUNT_ADMIN')) return hasRole(a, 'OWNER');
  return hasRole(a, 'OWNER', 'ACCOUNT_ADMIN', 'HR');
}

export function isAdminRole(role: Role): boolean {
  return role === 'OWNER' || role === 'ACCOUNT_ADMIN';
}

export const PROTECTED_USERNAMES = new Set(['hr', 'hr.ai', 'lemone.ai', 'admin', 'system', 'lemone', 'root', 'support']);

/** Username yang disarankan dari nama: huruf kecil, titik sebagai pemisah, tanpa tanda. */
export function suggestUsername(fullName: string, taken: (u: string) => boolean): string {
  const base = fullName
    .toLowerCase()
    .replace(/\(demo\)/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join('.');
  let u = base || 'karyawan';
  if (PROTECTED_USERNAMES.has(u)) u = `${u}.1`;
  let i = 1;
  let cand = u;
  while (taken(cand)) {
    i++;
    cand = `${u}${i}`;
  }
  return cand;
}

export function validUsername(u: string): boolean {
  return /^[a-z0-9](?:[a-z0-9._-]{1,30})[a-z0-9]$/.test(u) && !PROTECTED_USERNAMES.has(u);
}
