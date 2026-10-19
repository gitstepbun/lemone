import { randomToken, sha256, temporaryPassword } from '../common/crypto';
import { config } from '../config';
import { getDb } from '../db/db';
import { erp } from '../erp/erp.provider';
import { idp, IdpError } from '../idp/keycloak-admin';
import { defineJob, NeedsReviewError, RetryableError, type JobContext } from './jobs';

/** Tahap PROVISION_ACCOUNT: validasi karyawan → siapkan identitas IdP → simpan referensi → grant → undangan. */
defineJob('PROVISION_ACCOUNT', {
  initial: 'VALIDATE_EMPLOYEE',
  stages: {
    async VALIDATE_EMPLOYEE(ctx) {
      const db = getDb();
      const user = await db.selectFrom('directory.users').selectAll().where('id', '=', ctx.job.user_id!).executeTakeFirstOrThrow();
      if (!user.employee_id) throw new NeedsReviewError('User tanpa employee_id');
      const e = await erp().getEmployee(user.employee_id).catch((err) => {
        throw new RetryableError(`ERP: ${(err as Error).message}`);
      });
      if (!e) throw new NeedsReviewError(`Karyawan ${user.employee_id} tidak ditemukan di sumber resmi`);
      if (e.workStatus === 'TERMINATED' || e.workStatus === 'INACTIVE') throw new NeedsReviewError(`Status kerja ${e.workStatus}, akun tidak dibuat`);
      await db
        .insertInto('directory.employee_directory')
        .values({ org_id: 'lemone', employee_id: e.employeeId, full_name: e.fullName, division: e.division, position: e.position, manager_employee_id: e.managerEmployeeId, location: e.location, work_status: e.workStatus, email: e.email, phone: e.phone, source: erp().label, source_version: e.version })
        .onConflict((oc) => oc.columns(['org_id', 'employee_id']).doUpdateSet({ full_name: e.fullName, division: e.division, position: e.position, manager_employee_id: e.managerEmployeeId, work_status: e.workStatus, source_version: e.version, synced_at: new Date() }))
        .execute();
      return 'SETUP_IDENTITY';
    },
    async SETUP_IDENTITY(ctx) {
      const db = getDb();
      const user = await db.selectFrom('directory.users').selectAll().where('id', '=', ctx.job.user_id!).executeTakeFirstOrThrow();
      const kc = idp();
      // Referensi stabil: atribut lemone_user_id. Retry setelah timeout menemukan user yang sama, bukan membuat baru.
      let idpUser = user.idp_user_ref ? await kc.getUser(user.idp_user_ref) : null;
      if (!idpUser) idpUser = await kc.findByLemoneUserId(user.id);
      if (!idpUser) {
        const byName = await kc.findByUsername(user.username);
        if (byName) {
          // Username sudah dipakai identitas lain di IdP: jangan gabungkan otomatis.
          if (byName.attributes?.lemone_user_id?.[0] && byName.attributes.lemone_user_id[0] !== user.id) throw new NeedsReviewError(`Username ${user.username} sudah terikat ke identitas lain di IdP`);
          if (!byName.attributes?.lemone_user_id) throw new NeedsReviewError(`Username ${user.username} sudah ada di IdP tanpa referensi Lemone`);
          idpUser = byName;
        }
      }
      const [first, ...rest] = user.display_name.replace(/\s*\(DEMO\)\s*/i, '').split(' ');
      if (!idpUser) {
        try {
          const id = await kc.createUser({ username: user.username, firstName: first, lastName: rest.join(' ') || '-', lemoneUserId: user.id, employeeId: user.employee_id! });
          idpUser = { id, username: user.username, enabled: true };
        } catch (e) {
          if (e instanceof IdpError && e.status === 409) throw new NeedsReviewError('Username sudah ada di IdP');
          throw e;
        }
      }
      const temp = temporaryPassword();
      await kc.setTemporaryPassword(idpUser.id, temp);
      await kc.setRequiredActions(idpUser.id, ['UPDATE_PASSWORD']);
      if (!idpUser.enabled) await kc.setEnabled(idpUser.id, true);
      ctx.ephemeral.temporaryPassword = temp; // sekali-tampil, tidak disimpan
      await ctx.setStage('SAVE_REFERENCE', { idpUserId: idpUser.id });
      await db.updateTable('directory.users').set({ idp_user_ref: idpUser.id, updated_at: new Date() }).where('id', '=', user.id).execute();
      return 'SET_GRANTS';
    },
    async SET_GRANTS(ctx) {
      // Grant sudah dicatat PENDING saat pembuatan; efektif hanya setelah aktivasi ACTIVE.
      const n = await getDb().selectFrom('directory.application_grants').select('id').where('user_id', '=', ctx.job.user_id!).execute();
      if (!n.length) throw new NeedsReviewError('Akun tanpa akses aplikasi apa pun');
      return 'ISSUE_INVITATION';
    },
    async ISSUE_INVITATION(ctx) {
      await issueInvitation(ctx);
      return 'DONE';
    },
  },
});

/** Terbitkan undangan baru: batalkan yang lama, simpan hash, kembalikan token mentah via ephemeral. */
export async function issueInvitation(ctx: JobContext): Promise<void> {
  const db = getDb();
  const raw = randomToken(32);
  const ttl = Number(ctx.job.payload.ttlHours ?? config().INVITATION_TTL_HOURS);
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('directory.invitations')
      .set({ status: 'REVOKED', revoked_at: new Date(), revoked_by: (ctx.job.payload.actorUserId as string) ?? null })
      .where('user_id', '=', ctx.job.user_id!)
      .where('status', 'in', ['PENDING', 'RESERVED'])
      .execute();
    const inv = await trx
      .insertInto('directory.invitations')
      .values({
        user_id: ctx.job.user_id!,
        created_by: (ctx.job.payload.actorUserId as string) ?? null,
        token_hash: sha256(raw),
        delivery: (ctx.job.payload.delivery as 'HR_HANDOVER' | 'EMAIL') ?? 'HR_HANDOVER',
        status: 'PENDING',
        expires_at: new Date(Date.now() + ttl * 3600_000),
      })
      .returning(['id', 'expires_at'])
      .executeTakeFirstOrThrow();
    ctx.ephemeral.invitationToken = raw;
    ctx.ephemeral.invitationId = inv.id;
    ctx.ephemeral.expiresAt = inv.expires_at;
  });
}

/** Buat ulang undangan + kredensial sementara baru. */
defineJob('REISSUE_INVITATION', {
  initial: 'RESET_CREDENTIAL',
  stages: {
    async RESET_CREDENTIAL(ctx) {
      const user = await getDb().selectFrom('directory.users').selectAll().where('id', '=', ctx.job.user_id!).executeTakeFirstOrThrow();
      if (user.status !== 'PENDING_ACTIVATION') throw new NeedsReviewError('Hanya akun menunggu aktivasi yang bisa diundang ulang');
      if (!user.idp_user_ref) return 'SETUP_IDENTITY_FALLBACK';
      const temp = temporaryPassword();
      await idp().setTemporaryPassword(user.idp_user_ref, temp);
      await idp().setRequiredActions(user.idp_user_ref, ['UPDATE_PASSWORD']);
      ctx.ephemeral.temporaryPassword = temp;
      return 'ISSUE_INVITATION';
    },
    async SETUP_IDENTITY_FALLBACK() {
      throw new NeedsReviewError('Identitas IdP belum ada; jalankan ulang provisioning');
    },
    async ISSUE_INVITATION(ctx) {
      await issueInvitation(ctx);
      return 'DONE';
    },
  },
});

/** Nonaktifkan akun: pemblokiran lokal sudah dilakukan sinkron; job ini menuntaskan IdP dan push. */
defineJob('DEACTIVATE_ACCOUNT', {
  initial: 'IDP_DISABLE',
  stages: {
    async IDP_DISABLE(ctx) {
      const user = await getDb().selectFrom('directory.users').select('idp_user_ref').where('id', '=', ctx.job.user_id!).executeTakeFirstOrThrow();
      if (user.idp_user_ref) await idp().setEnabled(user.idp_user_ref, false);
      await ctx.setStage('IDP_LOGOUT', { idpDisabled: Boolean(user.idp_user_ref) });
      return 'IDP_LOGOUT';
    },
    async IDP_LOGOUT(ctx) {
      const user = await getDb().selectFrom('directory.users').select('idp_user_ref').where('id', '=', ctx.job.user_id!).executeTakeFirstOrThrow();
      if (user.idp_user_ref) await idp().logoutAll(user.idp_user_ref);
      await ctx.setStage('PUSH_REVOKE', { idpSessionsRevoked: true });
      return 'PUSH_REVOKE';
    },
    async PUSH_REVOKE(ctx) {
      await getDb().updateTable('directory.device_registrations').set({ revoked_at: new Date() }).where('user_id', '=', ctx.job.user_id!).where('revoked_at', 'is', null).execute();
      await ctx.setStage('DONE', { push: 'BELUM_TERHUBUNG', deviceRegistrationsRevoked: true });
      return 'DONE';
    },
  },
});

/** Cabut akses satu aplikasi: lokal sudah diblokir; tuntaskan registrasi push aplikasi itu. */
defineJob('REVOKE_APP', {
  initial: 'PUSH_REVOKE',
  stages: {
    async PUSH_REVOKE(ctx) {
      await getDb().updateTable('directory.device_registrations').set({ revoked_at: new Date() }).where('user_id', '=', ctx.job.user_id!).where('app', '=', String(ctx.job.payload.app)).where('revoked_at', 'is', null).execute();
      await ctx.setStage('DONE', { push: 'BELUM_TERHUBUNG' });
      return 'DONE';
    },
  },
});

/** Keluar dari semua perangkat: cabut sesi IdP (refresh token ikut mati). */
defineJob('LOGOUT_ALL', {
  initial: 'IDP_LOGOUT',
  stages: {
    async IDP_LOGOUT(ctx) {
      const user = await getDb().selectFrom('directory.users').select('idp_user_ref').where('id', '=', ctx.job.user_id!).executeTakeFirstOrThrow();
      if (user.idp_user_ref) await idp().logoutAll(user.idp_user_ref);
      return 'DONE';
    },
  },
});

/** Aktifkan kembali akun yang dinonaktifkan manual (hanya admin berwenang). */
defineJob('REACTIVATE_ACCOUNT', {
  initial: 'IDP_ENABLE',
  stages: {
    async IDP_ENABLE(ctx) {
      const user = await getDb().selectFrom('directory.users').select('idp_user_ref').where('id', '=', ctx.job.user_id!).executeTakeFirstOrThrow();
      if (user.idp_user_ref) await idp().setEnabled(user.idp_user_ref, true);
      return 'DONE';
    },
  },
});

/** Sinkronkan role MFA di IdP (lemone-admin) dengan role OWNER/ACCOUNT_ADMIN. */
defineJob('SYNC_IDP_ADMIN_ROLE', {
  initial: 'SYNC',
  stages: {
    async SYNC(ctx) {
      const db = getDb();
      const user = await db.selectFrom('directory.users').select('idp_user_ref').where('id', '=', ctx.job.user_id!).executeTakeFirstOrThrow();
      if (!user.idp_user_ref) return 'DONE';
      const admin = await db.selectFrom('directory.role_assignments').select('id').where('user_id', '=', ctx.job.user_id!).where('revoked_at', 'is', null).where('role', 'in', ['OWNER', 'ACCOUNT_ADMIN']).executeTakeFirst();
      if (admin) await idp().addRealmRole(user.idp_user_ref, 'lemone-admin');
      else await idp().removeRealmRole(user.idp_user_ref, 'lemone-admin').catch(() => undefined);
      return 'DONE';
    },
  },
});
