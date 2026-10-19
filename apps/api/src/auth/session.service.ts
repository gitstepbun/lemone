import { Injectable } from '@nestjs/common';
import { decryptJson, encryptJson } from '../common/crypto';
import { getDb } from '../db/db';
import { config, type AppKey } from '../config';
import { client, oidcConfig } from './oidc';

export interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  app: string;
  client_id: string;
  idp_session_state: string | null;
  access_expires_at: Date;
  revoked_at: Date | null;
}

@Injectable()
export class SessionService {
  async create(input: { userId: string; app: AppKey; tokens: StoredTokens; expiresIn: number; sessionState?: string; userAgent?: string; ip?: string }): Promise<string> {
    const c = config();
    const row = await getDb()
      .insertInto('directory.application_sessions')
      .values({
        user_id: input.userId,
        app: input.app,
        client_id: input.app === 'WORK' ? c.OIDC_CLIENT_WORK_ID : c.OIDC_CLIENT_CHAT_ID,
        idp_session_state: input.sessionState ?? null,
        token_ciphertext: encryptJson(input.tokens),
        access_expires_at: new Date(Date.now() + input.expiresIn * 1000),
        user_agent: input.userAgent?.slice(0, 300) ?? null,
        ip: input.ip ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async get(id: string): Promise<SessionRow | null> {
    const r = await getDb()
      .selectFrom('directory.application_sessions')
      .select(['id', 'user_id', 'app', 'client_id', 'idp_session_state', 'access_expires_at', 'revoked_at'])
      .where('id', '=', id)
      .executeTakeFirst();
    return r ?? null;
  }

  async tokens(id: string): Promise<StoredTokens | null> {
    const r = await getDb().selectFrom('directory.application_sessions').select('token_ciphertext').where('id', '=', id).executeTakeFirst();
    return r ? decryptJson<StoredTokens>(r.token_ciphertext) : null;
  }

  /** Segarkan access token bila hampir kedaluwarsa. Gagal refresh = sesi IdP hilang → sesi aplikasi dicabut. */
  async ensureFresh(s: SessionRow, app: AppKey): Promise<boolean> {
    if (s.access_expires_at.getTime() - Date.now() > 20_000) return true;
    const t = await this.tokens(s.id);
    if (!t?.refresh_token) {
      await this.revoke(s.id, 'NO_REFRESH_TOKEN');
      return false;
    }
    try {
      const cfg = await oidcConfig(app);
      const res = await client.refreshTokenGrant(cfg, t.refresh_token);
      await getDb()
        .updateTable('directory.application_sessions')
        .set({
          token_ciphertext: encryptJson({ access_token: res.access_token, refresh_token: res.refresh_token ?? t.refresh_token, id_token: res.id_token ?? t.id_token }),
          access_expires_at: new Date(Date.now() + (res.expiresIn() ?? 300) * 1000),
          last_seen_at: new Date(),
        })
        .where('id', '=', s.id)
        .execute();
      return true;
    } catch {
      await this.revoke(s.id, 'IDP_REFRESH_FAILED');
      return false;
    }
  }

  async touch(id: string): Promise<void> {
    await getDb().updateTable('directory.application_sessions').set({ last_seen_at: new Date() }).where('id', '=', id).execute();
  }

  async revoke(id: string, reason: string): Promise<void> {
    await getDb()
      .updateTable('directory.application_sessions')
      .set({ revoked_at: new Date(), revoke_reason: reason })
      .where('id', '=', id)
      .where('revoked_at', 'is', null)
      .execute();
  }

  async revokeAllForUser(userId: string, reason: string, app?: AppKey): Promise<number> {
    let q = getDb().updateTable('directory.application_sessions').set({ revoked_at: new Date(), revoke_reason: reason }).where('user_id', '=', userId).where('revoked_at', 'is', null);
    if (app) q = q.where('app', '=', app);
    const r = await q.executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0);
  }

  async listForUser(userId: string) {
    return getDb()
      .selectFrom('directory.application_sessions')
      .select(['id', 'app', 'created_at', 'last_seen_at', 'revoked_at', 'revoke_reason', 'user_agent', 'ip'])
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();
  }
}
