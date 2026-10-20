import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import argon2 from 'argon2';
import { sql } from 'kysely';
import { z } from 'zod';
import { audit } from '../common/audit';
import { E } from '../common/errors';
import { APPS, config } from '../config';
import { getDb } from '../db/db';
import { PROTECTED_USERNAMES, validUsername } from '../directory/permissions';
import { cookieOptions, Public } from './principal';
import { SessionService } from './session.service';

const zCreds = z.object({ username: z.string().min(3).max(32), password: z.string().min(8).max(128) });
const zRegister = zCreds.extend({ displayName: z.string().min(2).max(80) });

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const r = schema.safeParse(body);
  if (!r.success) throw E.invalid(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

/**
 * Mode AUTH_MODE=local: username + sandi disimpan sebagai hash argon2id di directory.local_credentials.
 * Sesi tetap memakai directory.application_sessions (cookie host-only). Tanpa IdP eksternal.
 * Pendaftar pertama menjadi OWNER + HR (admin aplikasi). REGISTRATION_OPEN=false menutup pendaftaran.
 */
@Controller('auth/chat')
@Public()
export class LocalAuthController {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  private ensureLocal() {
    if (config().AUTH_MODE !== 'local') throw E.notFound('Mode login');
  }

  @Get('mode')
  mode() {
    return { mode: config().AUTH_MODE, registrationOpen: config().AUTH_MODE === 'local' && config().REGISTRATION_OPEN };
  }

  @Post('register')
  async register(@Req() req: Request, @Res() res: Response, @Body() body: unknown) {
    this.ensureLocal();
    if (!config().REGISTRATION_OPEN) throw E.forbidden('Pendaftaran ditutup. Minta admin membuatkan akun.');
    const input = parse(zRegister, body);
    const username = input.username.trim().toLowerCase();
    if (!validUsername(username) || PROTECTED_USERNAMES.has(username)) throw E.invalid('Username: 3-32 huruf kecil/angka/titik, tidak boleh nama layanan.');
    const db = getDb();
    const userId = await db.transaction().execute(async (trx) => {
      await trx.selectFrom('directory.org_locks').selectAll().where('key', '=', 'admins').forUpdate().execute();
      const taken = await trx.selectFrom('directory.users').select('id').where('org_id', '=', 'lemone').where(sql`lower(username)`, '=', username).executeTakeFirst();
      if (taken) throw E.conflict('USERNAME_TAKEN', 'Username sudah dipakai.');
      const humans = await trx.selectFrom('directory.users').select((eb) => eb.fn.countAll().as('n')).where('kind', '=', 'HUMAN').executeTakeFirstOrThrow();
      const first = Number(humans.n) === 0;
      const u = await trx
        .insertInto('directory.users')
        .values({ org_id: 'lemone', employee_id: username, username, display_name: input.displayName.trim(), kind: 'HUMAN', status: 'ACTIVE' })
        .returning('id')
        .executeTakeFirstOrThrow();
      // Tanpa ERP, username menjadi nomor karyawan agar pengajuan izin dan absensi DEMO tetap berjalan.
      await trx
        .insertInto('directory.employee_directory')
        .values({ org_id: 'lemone', employee_id: username, full_name: input.displayName.trim(), division: 'Umum', position: null, manager_employee_id: null, location: null, work_status: 'ACTIVE', email: null, phone: null, source: 'PENDAFTARAN', source_version: null })
        .onConflict((oc) => oc.columns(['org_id', 'employee_id']).doNothing())
        .execute();
      await trx.insertInto('directory.local_credentials').values({ user_id: u.id, password_hash: await argon2.hash(input.password, { type: argon2.argon2id }) }).execute();
      await trx.insertInto('directory.application_grants').values({ user_id: u.id, app: 'CHAT', status: 'ACTIVE' }).execute();
      await trx.insertInto('directory.role_assignments').values({ user_id: u.id, role: 'EMPLOYEE', scope_divisions: null }).execute();
      if (first) {
        for (const role of ['OWNER', 'HR'] as const) await trx.insertInto('directory.role_assignments').values({ user_id: u.id, role, scope_divisions: null }).execute();
        await trx.insertInto('directory.hr_assignments').values({ hr_user_id: u.id, divisions: null }).execute();
      }
      await audit({ actorUserId: u.id, action: 'auth.register', targetType: 'user', targetId: u.id, details: { username, firstUser: first } }, trx);
      return u.id;
    });
    await this.issueSession(req, res, userId);
    res.json({ ok: true, userId });
  }

  @Post('password-login')
  async login(@Req() req: Request, @Res() res: Response, @Body() body: unknown) {
    this.ensureLocal();
    const input = parse(zCreds, body);
    const username = input.username.trim().toLowerCase();
    const db = getDb();
    const row = await db
      .selectFrom('directory.users as u')
      .innerJoin('directory.local_credentials as c', 'c.user_id', 'u.id')
      .select(['u.id', 'u.status', 'c.password_hash', 'c.failed_attempts', 'c.locked_until'])
      .where('u.org_id', '=', 'lemone')
      .where(sql`lower(u.username)`, '=', username)
      .executeTakeFirst();
    const deny = async (reason: string, userId?: string) => {
      await audit({ actorUserId: userId ?? null, action: 'auth.login', outcome: 'DENIED', details: { username, reason } });
      throw E.unauthenticated();
    };
    if (!row) { await argon2.hash(input.password); return deny('user tidak ada'); } // waktu konstan
    if (row.locked_until && row.locked_until.getTime() > Date.now()) return deny('terkunci', row.id);
    if (!(await argon2.verify(row.password_hash, input.password))) {
      const attempts = row.failed_attempts + 1;
      await db.updateTable('directory.local_credentials').set({ failed_attempts: attempts, locked_until: attempts >= 8 ? new Date(Date.now() + 15 * 60_000) : null }).where('user_id', '=', row.id).execute();
      return deny('sandi salah', row.id);
    }
    if (row.status === 'DISABLED') throw E.accountDisabled();
    if (row.status !== 'ACTIVE') throw E.accountPending();
    await db.updateTable('directory.local_credentials').set({ failed_attempts: 0, locked_until: null }).where('user_id', '=', row.id).execute();
    const grant = await db.selectFrom('directory.application_grants').select('status').where('user_id', '=', row.id).where('app', '=', 'CHAT').executeTakeFirst();
    if (grant?.status !== 'ACTIVE') throw E.noGrant('CHAT');
    const sid = await this.issueSession(req, res, row.id);
    await audit({ actorUserId: row.id, action: 'auth.login', targetType: 'session', targetId: sid, details: { app: 'CHAT', mode: 'LOCAL' } });
    res.json({ ok: true });
  }

  @Post('change-password')
  async changePassword(@Req() req: Request, @Body() body: unknown) {
    this.ensureLocal();
    const { current, next } = parse(z.object({ current: z.string().min(1), next: z.string().min(8).max(128) }), body);
    const sid = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${APPS.CHAT.cookie}=`))?.split('=')[1];
    const s = sid ? await this.sessions.get(sid) : null;
    if (!s || s.revoked_at) throw E.unauthenticated();
    if (req.headers['x-lemone-request'] !== '1') throw E.csrf();
    const cred = await getDb().selectFrom('directory.local_credentials').select('password_hash').where('user_id', '=', s.user_id).executeTakeFirstOrThrow();
    if (!(await argon2.verify(cred.password_hash, current))) throw E.invalid('Sandi saat ini salah.');
    await getDb().updateTable('directory.local_credentials').set({ password_hash: await argon2.hash(next, { type: argon2.argon2id }), password_changed_at: new Date() }).where('user_id', '=', s.user_id).execute();
    await this.sessions.revokeAllForUser(s.user_id, 'PASSWORD_CHANGED');
    await audit({ actorUserId: s.user_id, action: 'auth.password_change' });
    return { ok: true, note: 'Semua sesi diakhiri. Masuk kembali.' };
  }

  private async issueSession(req: Request, res: Response, userId: string): Promise<string> {
    const sid = await this.sessions.create({ userId, app: 'CHAT', tokens: { access_token: 'local' }, expiresIn: 3650 * 86400, userAgent: req.headers['user-agent'], ip: req.ip });
    res.cookie(APPS.CHAT.cookie, sid, { ...cookieOptions('CHAT'), maxAge: 30 * 24 * 3600 * 1000 });
    return sid;
  }
}
