import { describe, expect, it } from 'vitest';
import { canAssignRole, canDisableAccount, canGrantApp, canManageDivision, suggestUsername, validUsername } from '../../src/directory/permissions';

const owner = { userId: 'o', roles: [{ role: 'OWNER' as const, scope: null }] };
const adminHr = { userId: 'a', roles: [{ role: 'ACCOUNT_ADMIN' as const, scope: ['HR'] }] };
const adminAll = { userId: 'a2', roles: [{ role: 'ACCOUNT_ADMIN' as const, scope: null }] };
const hrProd = { userId: 'h', roles: [{ role: 'HR' as const, scope: ['Produksi'] }] };
const employee = { userId: 'e', roles: [{ role: 'EMPLOYEE' as const, scope: null }] };

describe('permissions', () => {
  it('cakupan divisi', () => {
    expect(canManageDivision(owner, 'Gudang')).toBe(true);
    expect(canManageDivision(adminHr, 'HR')).toBe(true);
    expect(canManageDivision(adminHr, 'Gudang')).toBe(false);
    expect(canManageDivision(hrProd, 'Produksi')).toBe(true);
    expect(canManageDivision(employee, 'Produksi')).toBe(false);
  });
  it('grant aplikasi: HR hanya CHAT, admin boleh WORK', () => {
    expect(canGrantApp(hrProd, 'CHAT', 'Produksi')).toBe(true);
    expect(canGrantApp(hrProd, 'WORK', 'Produksi')).toBe(false);
    expect(canGrantApp(adminHr, 'WORK', 'HR')).toBe(true);
    expect(canGrantApp(adminHr, 'WORK', 'Produksi')).toBe(false);
  });
  it('peran: tidak ada yang bisa memberi OWNER selain OWNER; admin tidak memperluas delegasi', () => {
    expect(canAssignRole(owner, 'OWNER', null, 'HR')).toBe(true);
    expect(canAssignRole(adminAll, 'OWNER', null, 'HR')).toBe(false);
    expect(canAssignRole(adminAll, 'ACCOUNT_ADMIN', null, 'HR')).toBe(false);
    expect(canAssignRole(adminHr, 'HR', ['HR'], 'HR')).toBe(true);
    expect(canAssignRole(adminHr, 'HR', ['Gudang'], 'HR')).toBe(false);
    expect(canAssignRole(adminHr, 'HR', null, 'HR')).toBe(false);
    expect(canAssignRole(hrProd, 'APPROVER', ['Produksi'], 'Produksi')).toBe(true);
    expect(canAssignRole(hrProd, 'HR', ['Produksi'], 'Produksi')).toBe(false);
  });
  it('nonaktifkan: admin hanya oleh OWNER', () => {
    expect(canDisableAccount(hrProd, 'Produksi', ['EMPLOYEE'])).toBe(true);
    expect(canDisableAccount(hrProd, 'Produksi', ['ACCOUNT_ADMIN'])).toBe(false);
    expect(canDisableAccount(owner, 'Produksi', ['OWNER'])).toBe(true);
  });
  it('username disarankan dan dilindungi', () => {
    expect(suggestUsername('Sari Lestari (DEMO)', () => false)).toBe('sari.lestari');
    expect(suggestUsername('Sari Lestari', (u) => u === 'sari.lestari')).toBe('sari.lestari2');
    expect(validUsername('hr')).toBe(false);
    expect(validUsername('admin')).toBe(false);
    expect(validUsername('sari.lestari')).toBe(true);
    expect(validUsername('Sari')).toBe(false);
  });
});
