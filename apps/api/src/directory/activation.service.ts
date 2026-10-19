import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { audit } from '../common/audit';
import { sha256 } from '../common/crypto';
import { config } from '../config';
import { getDb } from '../db/db';
import { emitOutbox } from '../provisioning/jobs';

export type InspectResult =
  | { status: 'VALID'; username: string; displayName: string; expiresAt: string; resumable: boolean }
  | { status: 'EXPIRED' | 'REVOKED' | 'USED' | 'INVALID' | 'IN_PROGRESS' };

@Injectable()
export class ActivationService {
  /** Membaca undangan tanpa mengonsumsinya (aman untuk preview/pemindai). */
  async inspect(token: string): Promise<InspectResult> {
    if (!token || token.length < 20) return { status: 'INVALID' };
    const inv = await getDb()
      .selectFrom('directory.invitations as i')
      .innerJoin('directory.users as u', 'u.id', 'i.user_id')
      .select(['i.id', 'i.status', 'i.expires_at', 'i.activation_id', 'u.username', 'u.display_name', 'u.status as user_status'])
      .where('i.token_hash', '=', sha256(token))
      .executeTakeFirst();
    if (!inv) return { status: 'INVALID' };
    if (inv.status === 'REVOKED' || inv.user_status === 'DISABLED') return { status: 'REVOKED' };
    if (inv.status === 'CONSUMED') return { status: 'USED' };
    if (inv.expires_at.getTime() < Date.now()) return { status: 'EXPIRED' };
    if (inv.status === 'RESERVED' && inv.activation_id) {
      const act = await getDb().selectFrom('directory.activations').select(['expires_at', 'status']).where('id', '=', inv.activation_id).executeTakeFirst();
      if (act && act.expires_at.getTime() > Date.now() && act.status !== 'COMPLETED') return { status: 'VALID', username: inv.username, displayName: inv.display_name, expiresAt: inv.expires_at.toISOString(), resumable: true };
    }
    return { status: 'VALID', username: inv.username, displayName: inv.display_name, expiresAt: inv.expires_at.toISOString(), resumable: false };
  }

  /**
   * Mulai aktivasi: reservasi atomik. Hanya satu proses yang bisa memegang undangan.
   * Proses lama yang kedaluwarsa (ACTIVATION_TTL) bisa diambil alih; proses hidup hanya bisa dilanjutkan pemegang cookie-nya.
   */
  async begin(token: string, resumeActivationId: string | null): Promise<{ ok: true; activationId: string; username: string } | { ok: false; reason: InspectResult['status'] }> {
    const db = getDb();
    const ttlMs = config().ACTIVATION_TTL_MINUTES * 60_000;
    return db.transaction().execute(async (trx) => {
      const inv = await trx
        .selectFrom('directory.invitations as i')
        .innerJoin('directory.users as u', 'u.id', 'i.user_id')
        .select(['i.id', 'i.user_id', 'i.status', 'i.expires_at', 'i.activation_id', 'u.username', 'u.idp_user_ref', 'u.status as user_status'])
        .where('i.token_hash', '=', sha256(token))
        .forUpdate()
        .executeTakeFirst();
      if (!inv) return { ok: false, reason: 'INVALID' as const };
      if (inv.status === 'CONSUMED') return { ok: false, reason: 'USED' as const };
      if (inv.status === 'REVOKED' || inv.user_status !== 'PENDING_ACTIVATION') return { ok: false, reason: 'REVOKED' as const };
      if (inv.expires_at.getTime() < Date.now()) {
        await trx.updateTable('directory.invitations').set({ status: 'EXPIRED' }).where('id', '=', inv.id).execute();
        return { ok: false, reason: 'EXPIRED' as const };
      }
      if (inv.status === 'RESERVED' && inv.activation_id) {
        const act = await trx.selectFrom('directory.activations').select(['id', 'expires_at', 'status']).where('id', '=', inv.activation_id).executeTakeFirst();
        const alive = act && act.expires_at.getTime() > Date.now() && ['STARTED', 'AWAITING_IDP', 'MISMATCH'].includes(act.status);
        if (alive) {
          if (resumeActivationId === act!.id) return { ok: true, activationId: act!.id, username: inv.username };
          return { ok: false, reason: 'IN_PROGRESS' as const };
        }
        if (act) await trx.updateTable('directory.activations').set({ status: 'EXPIRED' }).where('id', '=', act.id).execute();
      }
      const act = await trx
        .insertInto('directory.activations')
        .values({ invitation_id: inv.id, user_id: inv.user_id, status: 'STARTED', expected_idp_user_id: inv.idp_user_ref, expires_at: new Date(Date.now() + ttlMs) })
        .returning('id')
        .executeTakeFirstOrThrow();
      const upd = await trx
        .updateTable('directory.invitations')
        .set({ status: 'RESERVED', reserved_at: new Date(), activation_id: act.id })
        .where('id', '=', inv.id)
        .where('status', 'in', ['PENDING', 'RESERVED'])
        .executeTakeFirst();
      if (Number(upd.numUpdatedRows) !== 1) return { ok: false, reason: 'IN_PROGRESS' as const };
      await audit({ action: 'activation.begin', targetType: 'user', targetId: inv.user_id, details: { activationId: act.id } }, trx);
      return { ok: true, activationId: act.id, username: inv.username };
    });
  }

  async markAwaitingIdp(activationId: string) {
    await getDb().updateTable('directory.activations').set({ status: 'AWAITING_IDP' }).where('id', '=', activationId).where('status', 'in', ['STARTED', 'MISMATCH']).execute();
  }

  /**
   * Selesaikan aktivasi setelah IdP mengembalikan identitas. Tolak jika identitas bukan milik undangan,
   * atau subject sudah terikat ke akun lain. Grant PENDING menjadi ACTIVE hanya di sini.
   */
  async completeWithIdentity(activationId: string, id: { issuer: string; subject: string; idpUserId: string; idpUsername: string }): Promise<{ ok: true; userId: string } | { ok: false; reason: 'MISMATCH' | 'EXPIRED' | 'INVALID' | 'REVOKED' }> {
    const db = getDb();
    return db.transaction().execute(async (trx) => {
      const act = await trx.selectFrom('directory.activations').selectAll().where('id', '=', activationId).forUpdate().executeTakeFirst();
      if (!act) return { ok: false, reason: 'INVALID' as const };
      if (act.status === 'COMPLETED') return { ok: true, userId: act.user_id };
      if (act.expires_at.getTime() < Date.now()) return { ok: false, reason: 'EXPIRED' as const };
      const inv = await trx.selectFrom('directory.invitations').selectAll().where('id', '=', act.invitation_id).forUpdate().executeTakeFirstOrThrow();
      if (inv.status !== 'RESERVED' || inv.activation_id !== act.id) return { ok: false, reason: 'REVOKED' as const };
      if (inv.expires_at.getTime() < Date.now()) return { ok: false, reason: 'EXPIRED' as const };
      const user = await trx.selectFrom('directory.users').selectAll().where('id', '=', act.user_id).forUpdate().executeTakeFirstOrThrow();
      if (user.status !== 'PENDING_ACTIVATION') return { ok: false, reason: 'REVOKED' as const };

      const bound = await trx.selectFrom('directory.identity_bindings').select('user_id').where('issuer', '=', id.issuer).where('subject', '=', id.subject).executeTakeFirst();
      const mismatch = (act.expected_idp_user_id && act.expected_idp_user_id !== id.idpUserId) || (bound && bound.user_id !== user.id);
      if (mismatch) {
        await trx.updateTable('directory.activations').set({ status: 'MISMATCH', observed_subject: id.subject, error: `Masuk sebagai ${id.idpUsername}` }).where('id', '=', act.id).execute();
        await audit({ action: 'activation.mismatch', targetType: 'user', targetId: user.id, outcome: 'DENIED', details: { activationId, observedUsername: id.idpUsername } }, trx);
        return { ok: false, reason: 'MISMATCH' as const };
      }
      await trx
        .insertInto('directory.identity_bindings')
        .values({ user_id: user.id, issuer: id.issuer, subject: id.subject, idp_user_id: id.idpUserId })
        .onConflict((oc) => oc.columns(['issuer', 'subject']).doNothing())
        .execute();
      await trx.updateTable('directory.users').set({ status: 'ACTIVE', status_reason: null, authz_version: sql`authz_version + 1`, updated_at: new Date() }).where('id', '=', user.id).execute();
      await trx.updateTable('directory.application_grants').set({ status: 'ACTIVE' }).where('user_id', '=', user.id).where('status', '=', 'PENDING').execute();
      await trx.updateTable('directory.invitations').set({ status: 'CONSUMED', consumed_at: new Date() }).where('id', '=', inv.id).execute();
      await trx.updateTable('directory.activations').set({ status: 'COMPLETED', completed_at: new Date(), observed_subject: id.subject }).where('id', '=', act.id).execute();
      await audit({ actorUserId: user.id, action: 'activation.complete', targetType: 'user', targetId: user.id, details: { activationId, issuer: id.issuer } }, trx);
      await emitOutbox({ aggregate: 'user', aggregateId: user.id, type: 'ACCOUNT_ACTIVATED', payload: { userId: user.id } }, trx);
      return { ok: true, userId: user.id };
    });
  }
}
