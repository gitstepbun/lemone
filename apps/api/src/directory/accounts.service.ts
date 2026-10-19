import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { audit } from '../common/audit';
import { emitRevoke } from '../common/bus';
import { E } from '../common/errors';
import { config } from '../config';
import { getDb } from '../db/db';
import type { AppName, DB, Role } from '../db/types';
import { erp } from '../erp/erp.provider';
import { SessionService } from '../auth/session.service';
import type { Principal } from '../auth/principal';
import { emitOutbox, enqueueJob, runJobInline } from '../provisioning/jobs';
import { canAssignRole, canDisableAccount, canGrantApp, canManageAccounts, canManageDivision, canRevokeRole, isAdminRole, managementScope, suggestUsername, validUsername } from './permissions';

export interface HandoverPayload {
  username: string;
  temporaryPassword: string | null;
  activationUrl: string;
  expiresAt: string;
  delivery: 'HR_HANDOVER' | 'EMAIL';
  emailStatus: 'BELUM_TERHUBUNG' | 'TIDAK_DIPAKAI';
}

@Injectable()
export class AccountsService {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  private requireManager(actor: Principal) {
    if (!canManageAccounts(actor)) throw E.forbidden('Bukan pengelola akun.');
  }

  async division(userId: string): Promise<string> {
    const r = await getDb()
      .selectFrom('directory.users as u')
      .leftJoin('directory.employee_directory as e', (j) => j.onRef('e.employee_id', '=', 'u.employee_id').on('e.org_id', '=', 'lemone'))
      .select('e.division')
      .where('u.id', '=', userId)
      .executeTakeFirst();
    return r?.division ?? '';
  }

  /** Cari karyawan di sumber resmi; tandai yang sudah punya akun. */
  async searchEmployees(actor: Principal, q: string) {
    this.requireManager(actor);
    const scope = managementScope(actor);
    const list = q.trim() ? await erp().searchEmployees(q, 25) : (await erp().listEmployees()).slice(0, 50);
    const ids = list.map((e) => e.employeeId);
    const existing = ids.length ? await getDb().selectFrom('directory.users').select(['employee_id', 'status', 'username']).where('employee_id', 'in', ids).execute() : [];
    const byId = new Map(existing.map((u) => [u.employee_id, u]));
    const taken = new Set((await getDb().selectFrom('directory.users').select('username').execute()).map((u) => u.username.toLowerCase()));
    return {
      source: erp().label,
      connected: erp().connected,
      items: list
        .filter((e) => scope.all || scope.divisions.has(e.division))
        .map((e) => ({
          ...e,
          hasAccount: byId.has(e.employeeId),
          accountStatus: byId.get(e.employeeId)?.status ?? null,
          suggestedUsername: byId.get(e.employeeId)?.username ?? suggestUsername(e.fullName, (u) => taken.has(u)),
        })),
    };
  }

  async list(actor: Principal, opt: { q?: string; division?: string; status?: string; page: number; pageSize: number }) {
    this.requireManager(actor);
    const scope = managementScope(actor);
    const db = getDb();
    let q = db
      .selectFrom('directory.users as u')
      .leftJoin('directory.employee_directory as e', (j) => j.onRef('e.employee_id', '=', 'u.employee_id').on('e.org_id', '=', 'lemone'))
      .where('u.kind', '=', 'HUMAN');
    if (!scope.all) q = q.where('e.division', 'in', [...scope.divisions, '__none__']);
    if (opt.q) q = q.where((eb) => eb.or([eb('u.display_name', 'ilike', `%${opt.q}%`), eb('u.username', 'ilike', `%${opt.q}%`), eb('u.employee_id', 'ilike', `%${opt.q}%`)]));
    if (opt.division) q = q.where('e.division', '=', opt.division);
    if (opt.status) q = q.where('u.status', '=', opt.status as never);
    const total = Number((await q.select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()).n);
    const rows = await q
      .select(['u.id', 'u.employee_id', 'u.username', 'u.display_name', 'u.status', 'u.status_reason', 'e.division', 'e.position', 'e.work_status', 'u.created_at'])
      .orderBy('u.display_name')
      .limit(opt.pageSize)
      .offset((opt.page - 1) * opt.pageSize)
      .execute();
    const ids = rows.map((r) => r.id);
    const grants = ids.length ? await db.selectFrom('directory.application_grants').select(['user_id', 'app', 'status']).where('user_id', 'in', ids).execute() : [];
    const reviews = ids.length ? await db.selectFrom('ops.provisioning_jobs').select(['user_id']).where('user_id', 'in', ids).where('status', '=', 'NEEDS_REVIEW').execute() : [];
    const needs = new Set(reviews.map((r) => r.user_id));
    const divisions = await db.selectFrom('directory.employee_directory').select('division').distinct().orderBy('division').execute();
    return {
      total,
      page: opt.page,
      pageSize: opt.pageSize,
      divisions: divisions.map((d) => d.division).filter((d) => scope.all || scope.divisions.has(d)),
      items: rows.map((r) => ({
        ...r,
        grants: grants.filter((g) => g.user_id === r.id).map((g) => ({ app: g.app, status: g.status })),
        uiStatus: needs.has(r.id) ? 'PERLU_DITINJAU' : r.status,
      })),
    };
  }

  /** Buat akun: user PENDING + grant PENDING + job provisioning dijalankan inline agar kredensial sekali-tampil bisa diserahkan. */
  async create(actor: Principal, input: { employeeId: string; username: string; apps: AppName[]; delivery: 'HR_HANDOVER' | 'EMAIL'; roles?: Array<{ role: Role; scope: string[] | null }> }) {
    this.requireManager(actor);
    const username = input.username.trim().toLowerCase();
    if (!validUsername(username)) throw E.invalid('Username tidak valid atau dilindungi.');
    const emp = await erp().getEmployee(input.employeeId);
    if (!emp) throw E.notFound('Karyawan');
    if (!canManageDivision(actor, emp.division)) throw E.forbidden('Divisi di luar cakupan Anda.');
    if (!input.apps.length) throw E.invalid('Pilih minimal satu aplikasi.');
    for (const app of input.apps) if (!canGrantApp(actor, app, emp.division)) throw E.forbidden(`Tidak berwenang memberi akses ${app}.`);
    for (const r of input.roles ?? []) if (!canAssignRole(actor, r.role, r.scope, emp.division)) throw E.forbidden(`Tidak berwenang menetapkan peran ${r.role}.`);
    const db = getDb();
    const existing = await db.selectFrom('directory.users').select(['id', 'status']).where('org_id', '=', 'lemone').where('employee_id', '=', emp.employeeId).executeTakeFirst();
    if (existing) throw E.conflict('ALREADY_EXISTS', 'Karyawan ini sudah punya akun.', { userId: existing.id });
    const taken = await db.selectFrom('directory.users').select('id').where('org_id', '=', 'lemone').where(sql`lower(username)`, '=', username).executeTakeFirst();
    if (taken) throw E.conflict('USERNAME_TAKEN', 'Username sudah dipakai.');

    const userId = await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('directory.employee_directory')
        .values({ org_id: 'lemone', employee_id: emp.employeeId, full_name: emp.fullName, division: emp.division, position: emp.position, manager_employee_id: emp.managerEmployeeId, location: emp.location, work_status: emp.workStatus, email: emp.email, phone: emp.phone, source: erp().label, source_version: emp.version })
        .onConflict((oc) => oc.columns(['org_id', 'employee_id']).doUpdateSet({ full_name: emp.fullName, division: emp.division, work_status: emp.workStatus, synced_at: new Date() }))
        .execute();
      const u = await trx
        .insertInto('directory.users')
        .values({ org_id: 'lemone', employee_id: emp.employeeId, username, display_name: emp.fullName, kind: 'HUMAN', status: 'PENDING_ACTIVATION', status_reason: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const app of input.apps) await trx.insertInto('directory.application_grants').values({ user_id: u.id, app, status: 'PENDING', granted_by: actor.userId }).execute();
      await trx.insertInto('directory.role_assignments').values({ user_id: u.id, role: 'EMPLOYEE', scope_divisions: null, assigned_by: actor.userId }).execute();
      for (const r of input.roles ?? []) {
        await trx.insertInto('directory.role_assignments').values({ user_id: u.id, role: r.role, scope_divisions: r.scope, assigned_by: actor.userId }).execute();
        if (r.role === 'HR') await trx.insertInto('directory.hr_assignments').values({ hr_user_id: u.id, divisions: r.scope, assigned_by: actor.userId }).execute();
      }
      await audit({ actorUserId: actor.userId, action: 'account.create', targetType: 'user', targetId: u.id, details: { employeeId: emp.employeeId, username, apps: input.apps, delivery: input.delivery } }, trx);
      return u.id;
    });
    const jobId = await enqueueJob({ kind: 'PROVISION_ACCOUNT', userId, idempotencyKey: `provision:${userId}`, payload: { actorUserId: actor.userId, delivery: input.delivery } });
    if (input.roles?.some((r) => isAdminRole(r.role))) await enqueueJob({ kind: 'SYNC_IDP_ADMIN_ROLE', userId, idempotencyKey: `sync-admin-role:${userId}:create` });
    const run = await runJobInline(jobId);
    if (run.status === 'DONE' && input.roles?.some((r) => isAdminRole(r.role))) {
      const sync = await getDb().selectFrom('ops.provisioning_jobs').select('id').where('idempotency_key', '=', `sync-admin-role:${userId}:create`).executeTakeFirst();
      if (sync) await runJobInline(sync.id);
    }
    const handover = this.handover(username, run.ephemeral, input.delivery);
    return { userId, jobId, jobStatus: run.status, stage: run.stage, error: run.error, handover };
  }

  private handover(username: string, eph: Record<string, unknown>, delivery: 'HR_HANDOVER' | 'EMAIL'): HandoverPayload | null {
    if (!eph.invitationToken) return null;
    return {
      username,
      temporaryPassword: (eph.temporaryPassword as string) ?? null,
      activationUrl: `${config().WORK_PUBLIC_URL}/activate?t=${eph.invitationToken as string}`,
      expiresAt: (eph.expiresAt as Date).toISOString(),
      delivery,
      emailStatus: delivery === 'EMAIL' ? 'BELUM_TERHUBUNG' : 'TIDAK_DIPAKAI',
    };
  }

  async detail(actor: Principal, userId: string) {
    this.requireManager(actor);
    const db = getDb();
    const u = await db
      .selectFrom('directory.users as u')
      .leftJoin('directory.employee_directory as e', (j) => j.onRef('e.employee_id', '=', 'u.employee_id').on('e.org_id', '=', 'lemone'))
      .select(['u.id', 'u.employee_id', 'u.username', 'u.display_name', 'u.kind', 'u.status', 'u.status_reason', 'u.manual_disabled', 'u.created_at', 'u.updated_at', 'e.division', 'e.position', 'e.manager_employee_id', 'e.work_status', 'e.source', 'e.synced_at'])
      .where('u.id', '=', userId)
      .executeTakeFirst();
    if (!u) throw E.notFound('Akun');
    if (!canManageDivision(actor, u.division ?? '')) throw E.forbidden('Di luar cakupan Anda.');
    const [grants, roles, invitations, jobs, sessions, auditRows, hr, binding] = await Promise.all([
      db.selectFrom('directory.application_grants').select(['app', 'status', 'granted_at', 'revoked_at']).where('user_id', '=', userId).execute(),
      db.selectFrom('directory.role_assignments').select(['id', 'role', 'scope_divisions', 'assigned_at']).where('user_id', '=', userId).where('revoked_at', 'is', null).execute(),
      db.selectFrom('directory.invitations').select(['id', 'status', 'delivery', 'expires_at', 'created_at', 'consumed_at', 'revoked_at']).where('user_id', '=', userId).orderBy('created_at', 'desc').limit(5).execute(),
      db.selectFrom('ops.provisioning_jobs').select(['id', 'kind', 'stage', 'status', 'attempts', 'last_error', 'updated_at', 'result']).where('user_id', '=', userId).orderBy('created_at', 'desc').limit(10).execute(),
      this.sessions.listForUser(userId),
      db.selectFrom('ops.audit_events').select(['at', 'actor_user_id', 'action', 'outcome', 'details']).where('target_type', '=', 'user').where('target_id', '=', userId).orderBy('at', 'desc').limit(30).execute(),
      db.selectFrom('directory.hr_assignments').select(['id', 'divisions', 'assigned_at']).where('hr_user_id', '=', userId).where('revoked_at', 'is', null).execute(),
      db.selectFrom('directory.identity_bindings').select(['issuer', 'created_at']).where('user_id', '=', userId).executeTakeFirst(),
    ]);
    const pendingSync = jobs.filter((j) => j.status === 'PENDING' || j.status === 'RUNNING');
    const review = jobs.filter((j) => j.status === 'NEEDS_REVIEW');
    return {
      user: u,
      identity: binding ? { issuer: binding.issuer, boundAt: binding.created_at } : null,
      grants,
      roles,
      hrAssignments: hr,
      invitations,
      jobs: jobs.map((j) => ({ ...j, result: this.safeResult(j.result as Record<string, unknown>) })),
      sessions,
      audit: auditRows,
      syncStatus: review.length ? 'PERLU_DITINJAU' : pendingSync.length ? 'SEDANG_DIPROSES' : 'SELESAI',
      uiStatus: review.length ? 'PERLU_DITINJAU' : u.status,
    };
  }

  private safeResult(r: Record<string, unknown>) {
    const { idpUserId: _omit, ...rest } = r;
    return rest;
  }

  async reissueInvitation(actor: Principal, userId: string, delivery: 'HR_HANDOVER' | 'EMAIL') {
    const d = await this.detail(actor, userId);
    if (d.user.status !== 'PENDING_ACTIVATION') throw E.conflict('NOT_PENDING', 'Akun sudah aktif atau nonaktif.');
    const jobId = await enqueueJob({ kind: 'REISSUE_INVITATION', userId, idempotencyKey: `reissue:${userId}:${Date.now()}`, payload: { actorUserId: actor.userId, delivery } });
    const run = await runJobInline(jobId);
    await audit({ actorUserId: actor.userId, action: 'invitation.reissue', targetType: 'user', targetId: userId, outcome: run.status === 'DONE' ? 'OK' : 'FAILED', details: { jobId, delivery } });
    return { jobId, jobStatus: run.status, error: run.error, handover: this.handover(d.user.username, run.ephemeral, delivery) };
  }

  async revokeInvitation(actor: Principal, userId: string) {
    await this.detail(actor, userId);
    const r = await getDb()
      .updateTable('directory.invitations')
      .set({ status: 'REVOKED', revoked_at: new Date(), revoked_by: actor.userId })
      .where('user_id', '=', userId)
      .where('status', 'in', ['PENDING', 'RESERVED'])
      .executeTakeFirst();
    await audit({ actorUserId: actor.userId, action: 'invitation.revoke', targetType: 'user', targetId: userId, details: { count: Number(r.numUpdatedRows) } });
    return { revoked: Number(r.numUpdatedRows) };
  }

  async setGrant(actor: Principal, userId: string, app: AppName, enable: boolean) {
    if (userId === actor.userId) throw E.forbidden('Tidak bisa mengubah akses sendiri.');
    const d = await this.detail(actor, userId);
    if (!canGrantApp(actor, app, d.user.division ?? '')) throw E.forbidden(`Tidak berwenang mengatur akses ${app}.`);
    const db = getDb();
    if (enable) {
      const status = d.user.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING';
      await db
        .insertInto('directory.application_grants')
        .values({ user_id: userId, app, status, granted_by: actor.userId })
        .onConflict((oc) => oc.columns(['user_id', 'app']).doUpdateSet({ status, granted_by: actor.userId, granted_at: new Date(), revoked_at: null, revoked_by: null }))
        .execute();
      await db.updateTable('directory.users').set({ authz_version: sql`authz_version + 1` }).where('id', '=', userId).execute();
      await audit({ actorUserId: actor.userId, action: 'grant.add', targetType: 'user', targetId: userId, details: { app, status } });
      return { app, status };
    }
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('directory.application_grants').set({ status: 'REVOKED', revoked_at: new Date(), revoked_by: actor.userId }).where('user_id', '=', userId).where('app', '=', app).execute();
      await trx.updateTable('directory.users').set({ authz_version: sql`authz_version + 1` }).where('id', '=', userId).execute();
      await audit({ actorUserId: actor.userId, action: 'grant.revoke', targetType: 'user', targetId: userId, details: { app } }, trx);
    });
    await this.sessions.revokeAllForUser(userId, `APP_REVOKED:${app}`, app);
    emitRevoke({ userId, app, reason: 'APP_REVOKED' });
    await enqueueJob({ kind: 'REVOKE_APP', userId, idempotencyKey: `revoke-app:${userId}:${app}:${Date.now()}`, payload: { app, actorUserId: actor.userId } });
    return { app, status: 'REVOKED' };
  }

  async assignRole(actor: Principal, userId: string, role: Role, scope: string[] | null) {
    if (userId === actor.userId) throw E.forbidden('Tidak bisa mengubah peran sendiri.');
    const d = await this.detail(actor, userId);
    if (!canAssignRole(actor, role, scope, d.user.division ?? '')) throw E.forbidden(`Tidak berwenang menetapkan ${role} dengan cakupan itu.`);
    const db = getDb();
    const id = await db.transaction().execute(async (trx) => {
      await trx.updateTable('directory.role_assignments').set({ revoked_at: new Date(), revoked_by: actor.userId }).where('user_id', '=', userId).where('role', '=', role).where('revoked_at', 'is', null).execute();
      const r = await trx.insertInto('directory.role_assignments').values({ user_id: userId, role, scope_divisions: scope, assigned_by: actor.userId }).returning('id').executeTakeFirstOrThrow();
      if (role === 'HR') {
        await trx.updateTable('directory.hr_assignments').set({ revoked_at: new Date() }).where('hr_user_id', '=', userId).where('revoked_at', 'is', null).execute();
        await trx.insertInto('directory.hr_assignments').values({ hr_user_id: userId, divisions: scope, assigned_by: actor.userId }).execute();
      }
      await trx.updateTable('directory.users').set({ authz_version: sql`authz_version + 1` }).where('id', '=', userId).execute();
      await audit({ actorUserId: actor.userId, action: 'role.assign', targetType: 'user', targetId: userId, details: { role, scope } }, trx);
      return r.id;
    });
    if (isAdminRole(role)) await enqueueJob({ kind: 'SYNC_IDP_ADMIN_ROLE', userId, idempotencyKey: `sync-admin-role:${userId}:${Date.now()}` });
    if (role === 'HR') await emitOutbox({ aggregate: 'user', aggregateId: userId, type: 'HR_ASSIGNED', payload: { divisions: scope } });
    return { id, role, scope };
  }

  async revokeRole(actor: Principal, userId: string, role: Role) {
    if (userId === actor.userId) throw E.forbidden('Tidak bisa mengubah peran sendiri.');
    const d = await this.detail(actor, userId);
    if (!canRevokeRole(actor, role, d.user.division ?? '')) throw E.forbidden(`Tidak berwenang mencabut ${role}.`);
    const db = getDb();
    await db.transaction().execute(async (trx) => {
      if (isAdminRole(role)) await this.assertNotLastAdmin(trx, userId);
      await trx.updateTable('directory.role_assignments').set({ revoked_at: new Date(), revoked_by: actor.userId }).where('user_id', '=', userId).where('role', '=', role).where('revoked_at', 'is', null).execute();
      if (role === 'HR') await trx.updateTable('directory.hr_assignments').set({ revoked_at: new Date() }).where('hr_user_id', '=', userId).where('revoked_at', 'is', null).execute();
      await trx.updateTable('directory.users').set({ authz_version: sql`authz_version + 1` }).where('id', '=', userId).execute();
      await audit({ actorUserId: actor.userId, action: 'role.revoke', targetType: 'user', targetId: userId, details: { role } }, trx);
    });
    if (isAdminRole(role)) await enqueueJob({ kind: 'SYNC_IDP_ADMIN_ROLE', userId, idempotencyKey: `sync-admin-role:${userId}:${Date.now()}` });
    return { role, status: 'REVOKED' };
  }

  /**
   * Perlindungan administrator terakhir. Mengunci baris org_locks('admins') sehingga dua perubahan
   * bersamaan diserialisasi; keduanya tidak bisa sama-sama lolos.
   */
  private async assertNotLastAdmin(trx: Transaction<DB>, excludingUserId: string) {
    await trx.selectFrom('directory.org_locks').selectAll().where('key', '=', 'admins').forUpdate().execute();
    const others = await trx
      .selectFrom('directory.role_assignments as r')
      .innerJoin('directory.users as u', 'u.id', 'r.user_id')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('r.revoked_at', 'is', null)
      .where('r.role', 'in', ['OWNER', 'ACCOUNT_ADMIN'])
      .where('r.scope_divisions', 'is', null) // admin dengan cakupan terbatas tidak dihitung sebagai administrator organisasi
      .where('u.status', '=', 'ACTIVE')
      .where('u.kind', '=', 'HUMAN')
      .where('u.id', '!=', excludingUserId)
      .executeTakeFirstOrThrow();
    if (Number(others.n) === 0) throw E.conflict('LAST_ADMIN', 'Ini administrator manusia aktif terakhir. Pindahkan tanggung jawab dulu.');
  }

  /** Nonaktifkan akun: blokir lokal segera, tuntaskan IdP/push lewat job persisten. */
  async disable(actor: Principal, userId: string, reason: string, opt: { fromErp?: boolean } = {}) {
    if (userId === actor.userId) throw E.forbidden('Tidak bisa menonaktifkan akun sendiri.');
    const d = await this.detail(actor, userId);
    if (!canDisableAccount(actor, d.user.division ?? '', d.roles.map((r) => r.role))) throw E.forbidden('Tidak berwenang menonaktifkan akun ini.');
    return this.disableInternal(userId, reason, { actorUserId: actor.userId, fromErp: Boolean(opt.fromErp), hasAdminRole: d.roles.some((r) => isAdminRole(r.role)) });
  }

  async disableInternal(userId: string, reason: string, o: { actorUserId: string | null; fromErp: boolean; hasAdminRole: boolean }) {
    const db = getDb();
    await db.transaction().execute(async (trx) => {
      if (o.hasAdminRole) {
        if (o.fromErp) {
          // Offboarding dari ERP tetap wajib walau admin terakhir; organisasi ditandai perlu pemulihan.
          await audit({ actorKind: 'WORKER', action: 'org.admin_gap', targetType: 'user', targetId: userId, outcome: 'FAILED', details: { note: 'Admin manusia terakhir dinonaktifkan karena offboarding ERP. Jalankan bootstrap:owner untuk pemulihan.' } }, trx);
        } else await this.assertNotLastAdmin(trx, userId);
      }
      await trx
        .updateTable('directory.users')
        .set({ status: 'DISABLED', status_reason: reason, manual_disabled: !o.fromErp, disabled_at: new Date(), tokens_not_before: new Date(), authz_version: sql`authz_version + 1`, updated_at: new Date() })
        .where('id', '=', userId)
        .execute();
      await trx.updateTable('directory.invitations').set({ status: 'REVOKED', revoked_at: new Date() }).where('user_id', '=', userId).where('status', 'in', ['PENDING', 'RESERVED']).execute();
      await audit({ actorUserId: o.actorUserId, actorKind: o.actorUserId ? 'USER' : 'WORKER', action: 'account.disable', targetType: 'user', targetId: userId, details: { reason, fromErp: o.fromErp } }, trx);
    });
    const n = await this.sessions.revokeAllForUser(userId, 'ACCOUNT_DISABLED');
    emitRevoke({ userId, reason: 'ACCOUNT_DISABLED' });
    const jobId = await enqueueJob({ kind: 'DEACTIVATE_ACCOUNT', userId, idempotencyKey: `deactivate:${userId}:${Date.now()}`, payload: { actorUserId: o.actorUserId, reason } });
    return { status: 'DISABLED', localSessionsRevoked: n, jobId, remote: 'DIJADWALKAN' };
  }

  async reactivate(actor: Principal, userId: string) {
    if (userId === actor.userId) throw E.forbidden('Tidak bisa mengaktifkan akun sendiri.');
    const d = await this.detail(actor, userId);
    if (d.user.status !== 'DISABLED') throw E.conflict('NOT_DISABLED', 'Akun tidak dalam keadaan nonaktif.');
    if (!canDisableAccount(actor, d.user.division ?? '', d.roles.map((r) => r.role))) throw E.forbidden('Tidak berwenang.');
    if (d.user.work_status === 'TERMINATED') throw E.conflict('ERP_TERMINATED', 'Status kerja di sumber resmi TERMINATED.');
    await getDb().updateTable('directory.users').set({ status: 'ACTIVE', status_reason: null, manual_disabled: false, disabled_at: null, authz_version: sql`authz_version + 1`, updated_at: new Date() }).where('id', '=', userId).execute();
    await audit({ actorUserId: actor.userId, action: 'account.reactivate', targetType: 'user', targetId: userId });
    await enqueueJob({ kind: 'REACTIVATE_ACCOUNT', userId, idempotencyKey: `reactivate:${userId}:${Date.now()}` });
    return { status: 'ACTIVE' };
  }

  async revokeSession(actor: Principal, userId: string, sessionId: string) {
    await this.detail(actor, userId);
    const s = await this.sessions.get(sessionId);
    if (!s || s.user_id !== userId) throw E.notFound('Sesi');
    await this.sessions.revoke(sessionId, 'ADMIN_REVOKED');
    emitRevoke({ userId, reason: 'SESSION_REVOKED' });
    await audit({ actorUserId: actor.userId, action: 'session.revoke', targetType: 'user', targetId: userId, details: { sessionId } });
    return { ok: true };
  }

  async logoutAllDevices(actor: Principal, userId: string) {
    await this.detail(actor, userId);
    const n = await this.sessions.revokeAllForUser(userId, 'ADMIN_LOGOUT_ALL');
    await getDb().updateTable('directory.users').set({ tokens_not_before: new Date(), authz_version: sql`authz_version + 1` }).where('id', '=', userId).execute();
    emitRevoke({ userId, reason: 'LOGOUT_ALL' });
    await enqueueJob({ kind: 'LOGOUT_ALL', userId, idempotencyKey: `logout-all:${userId}:${Date.now()}` });
    await audit({ actorUserId: actor.userId, action: 'session.logout_all', targetType: 'user', targetId: userId, details: { sessionsRevoked: n } });
    return { sessionsRevoked: n, idp: 'DIJADWALKAN' };
  }

  /** Mulai pemulihan akses: kredensial sementara baru (tanpa email) oleh petugas berwenang. */
  async startRecovery(actor: Principal, userId: string) {
    const d = await this.detail(actor, userId);
    if (d.user.status !== 'ACTIVE') throw E.conflict('NOT_ACTIVE', 'Pemulihan hanya untuk akun aktif.');
    const u = await getDb().selectFrom('directory.users').select('idp_user_ref').where('id', '=', userId).executeTakeFirstOrThrow();
    if (!u.idp_user_ref) throw E.conflict('NO_IDP', 'Identitas IdP tidak ditemukan.');
    const { idp } = await import('../idp/keycloak-admin');
    const { temporaryPassword } = await import('../common/crypto');
    const temp = temporaryPassword();
    await idp().setTemporaryPassword(u.idp_user_ref, temp);
    await idp().setRequiredActions(u.idp_user_ref, ['UPDATE_PASSWORD']);
    await idp().logoutAll(u.idp_user_ref);
    await this.sessions.revokeAllForUser(userId, 'RECOVERY');
    await getDb().updateTable('directory.users').set({ tokens_not_before: new Date() }).where('id', '=', userId).execute();
    emitRevoke({ userId, reason: 'RECOVERY' });
    await audit({ actorUserId: actor.userId, action: 'account.recovery', targetType: 'user', targetId: userId, details: { method: 'HR_VERIFIED_TEMP_CREDENTIAL' } });
    return { username: d.user.username, temporaryPassword: temp, note: 'Serahkan langsung ke pemilik akun setelah verifikasi identitas. Tidak disimpan.' };
  }
}
