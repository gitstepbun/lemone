import { Controller, Get, Post, Query, Req, Res, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { parse as parseCookie } from 'cookie';
import { APPS, APP_PATH, config, type AppKey } from '../config';
import { decryptJson, encryptJson } from '../common/crypto';
import { audit } from '../common/audit';
import { E } from '../common/errors';
import { getDb } from '../db/db';
import { ActivationService } from '../directory/activation.service';
import { cookieOptions, PrincipalService, Public } from './principal';
import { client, oidcConfig, redirectUri } from './oidc';
import { SessionService } from './session.service';
import { idp } from '../idp/keycloak-admin';

interface PendingAuth { v: string; s: string; n: string; r: string; a: string | null; t: number }

function appFrom(p: string): AppKey {
  const a = APP_PATH[p];
  if (!a) throw E.notFound('Aplikasi');
  return a;
}
function requireOidc() {
  if (config().AUTH_MODE !== 'oidc') throw E.notFound('Login OIDC');
}

/** Hanya path relatif same-origin yang boleh jadi tujuan setelah login. */
export function safeReturn(r: string | undefined, fallback = '/'): string {
  if (!r || !r.startsWith('/') || r.startsWith('//') || r.includes('\\') || r.includes('://')) return fallback;
  return r;
}

@Controller('auth')
@Public()
export class AuthController {
  constructor(@Inject(SessionService) private readonly sessions: SessionService, @Inject(PrincipalService) private readonly principals: PrincipalService, @Inject(ActivationService) private readonly activation: ActivationService) {}

  /** Mulai login. Opsional: return (path), activation (id konteks aktivasi), prompt=login. */
  @Get(':app/login')
  async login(@Req() req: Request, @Res() res: Response, @Query('return') ret?: string, @Query('activation') activation?: string, @Query('prompt') prompt?: string, @Query('login_hint') loginHint?: string) {
    requireOidc();
    const app = appFrom(String(req.params.app));
    const cfg = await oidcConfig(app);
    const verifier = client.randomPKCECodeVerifier();
    const challenge = await client.calculatePKCECodeChallenge(verifier);
    const state = client.randomState();
    const nonce = client.randomNonce();
    const pending: PendingAuth = { v: verifier, s: state, n: nonce, r: safeReturn(ret), a: activation ?? null, t: Date.now() };
    res.cookie(`la_${app.toLowerCase()}`, encryptJson(pending).toString('base64url'), { ...cookieOptions(app), maxAge: 10 * 60 * 1000 });
    const params: Record<string, string> = {
      redirect_uri: redirectUri(app),
      scope: 'openid profile',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      nonce,
      ui_locales: 'id',
    };
    if (prompt === 'login' || activation) params.prompt = 'login';
    if (loginHint) params.login_hint = loginHint;
    res.redirect(client.buildAuthorizationUrl(cfg, params).href);
  }

  @Get(':app/callback')
  async callback(@Req() req: Request, @Res() res: Response) {
    requireOidc();
    const app = appFrom(String(req.params.app));
    const pub = APPS[app].publicUrl();
    const cookieName = `la_${app.toLowerCase()}`;
    const raw = parseCookie(req.headers.cookie ?? '')[cookieName];
    res.clearCookie(cookieName, cookieOptions(app));
    const fail = (reason: string) => res.redirect(`${pub}/masuk?error=${encodeURIComponent(reason)}`);
    if (!raw) return fail('sesi_login_hilang');
    let pending: PendingAuth;
    try {
      pending = decryptJson<PendingAuth>(Buffer.from(raw, 'base64url'));
    } catch {
      return fail('sesi_login_rusak');
    }
    if (Date.now() - pending.t > 10 * 60 * 1000) return fail('sesi_login_kedaluwarsa');

    const cfg = await oidcConfig(app);
    const current = new URL(`${redirectUri(app)}?${new URLSearchParams(req.query as Record<string, string>).toString()}`);
    let tokens;
    try {
      tokens = await client.authorizationCodeGrant(cfg, current, { pkceCodeVerifier: pending.v, expectedState: pending.s, expectedNonce: pending.n, idTokenExpected: true });
    } catch (e) {
      await audit({ action: 'auth.callback', outcome: 'DENIED', details: { app, reason: (e as Error).message.slice(0, 200) } });
      return fail('callback_ditolak');
    }
    const claims = tokens.claims()!;
    const iss = String(claims.iss);
    const sub = String(claims.sub);
    const sid = typeof claims.sid === 'string' ? claims.sid : null;
    const idpUsername = typeof claims.preferred_username === 'string' ? claims.preferred_username : sub;
    const db = getDb();

    // Aktivasi: ikat identitas ke undangan yang direservasi, tolak jika orangnya berbeda.
    let activated = false;
    if (pending.a) {
      const r = await this.activation.completeWithIdentity(pending.a, { issuer: iss, subject: sub, idpUserId: sub, idpUsername });
      if (!r.ok) {
        if (r.reason === 'MISMATCH') return res.redirect(`${pub}/activate?status=mismatch&as=${encodeURIComponent(idpUsername)}`);
        return res.redirect(`${pub}/activate?status=${encodeURIComponent(r.reason.toLowerCase())}`);
      }
      activated = true;
      res.clearCookie('lact', cookieOptions(app));
    }

    const binding = await db.selectFrom('directory.identity_bindings').select('user_id').where('issuer', '=', iss).where('subject', '=', sub).executeTakeFirst();
    if (!binding) {
      // Identitas IdP ada tetapi belum diaktifkan lewat undangan (login langsung / ganti sandi pertama tidak mengaktifkan akun).
      const pendingUser = await db.selectFrom('directory.users').select(['id', 'status']).where('idp_user_ref', '=', sub).executeTakeFirst();
      if (pendingUser?.status === 'PENDING_ACTIVATION') {
        await audit({ actorUserId: pendingUser.id, action: 'auth.login', outcome: 'DENIED', details: { app, reason: 'akun belum diaktifkan (tanpa binding)' } });
        return res.redirect(`${pub}/akun-belum-aktif`);
      }
      await audit({ action: 'auth.login', outcome: 'DENIED', details: { app, reason: 'identitas tidak terdaftar', issuer: iss } });
      return fail('tidak_terdaftar');
    }
    const user = await db.selectFrom('directory.users').select(['id', 'status', 'username']).where('id', '=', binding.user_id).executeTakeFirst();
    if (!user) return fail('tidak_terdaftar');
    if (user.status === 'DISABLED') {
      await audit({ actorUserId: user.id, action: 'auth.login', outcome: 'DENIED', details: { app, reason: 'akun nonaktif' } });
      return fail('nonaktif');
    }
    if (user.status !== 'ACTIVE') {
      await audit({ actorUserId: user.id, action: 'auth.login', outcome: 'DENIED', details: { app, reason: 'akun belum aktif' } });
      return res.redirect(`${pub}/akun-belum-aktif`);
    }
    const grant = await db.selectFrom('directory.application_grants').select('status').where('user_id', '=', user.id).where('app', '=', app).executeTakeFirst();
    if (grant?.status !== 'ACTIVE') {
      if (activated) return res.redirect(`${pub}/activate?status=done`);
      await audit({ actorUserId: user.id, action: 'auth.login', outcome: 'DENIED', details: { app, reason: 'tanpa grant aplikasi' } });
      return fail('tanpa_akses');
    }
    const sessionId = await this.sessions.create({
      userId: user.id,
      app,
      tokens: { access_token: tokens.access_token, refresh_token: tokens.refresh_token, id_token: tokens.id_token },
      expiresIn: tokens.expiresIn() ?? 300,
      sessionState: sid ?? undefined,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    res.cookie(APPS[app].cookie, sessionId, { ...cookieOptions(app), maxAge: 30 * 24 * 3600 * 1000 });
    await audit({ actorUserId: user.id, action: 'auth.login', targetType: 'session', targetId: sessionId, details: { app, mode: 'SESSION' } });
    res.redirect(activated ? `${pub}/activate?status=done` : `${pub}${pending.r}`);
  }

  /** Keluar dari aplikasi ini. Sesi SSO di browser tetap ada; sertakan ?sso=1 untuk mengakhiri sesi IdP juga. */
  @Post(':app/logout')
  async logout(@Req() req: Request, @Res() res: Response, @Query('sso') sso?: string) {
    const app = appFrom(String(req.params.app));
    const pub = APPS[app].publicUrl();
    const cookies = parseCookie(req.headers.cookie ?? '');
    const sid = cookies[APPS[app].cookie];
    res.clearCookie(APPS[app].cookie, cookieOptions(app));
    let idToken: string | undefined;
    if (sid) {
      const s = await this.sessions.get(sid);
      if (s && !s.revoked_at) {
        idToken = (await this.sessions.tokens(sid))?.id_token;
        await this.sessions.revoke(sid, 'USER_LOGOUT');
        await audit({ actorUserId: s.user_id, action: 'auth.logout', targetType: 'session', targetId: sid, details: { app, sso: sso === '1' } });
      }
    }
    if (sso === '1' && config().AUTH_MODE === 'oidc') {
      const cfg = await oidcConfig(app);
      const url = client.buildEndSessionUrl(cfg, { post_logout_redirect_uri: `${pub}/masuk`, ...(idToken ? { id_token_hint: idToken } : {}) });
      return res.json({ ok: true, redirect: url.href, ssoEnded: true });
    }
    return res.json({ ok: true, redirect: `${pub}/masuk`, ssoEnded: config().AUTH_MODE === 'local', note: config().AUTH_MODE === 'local' ? undefined : 'Sesi SSO browser masih aktif sampai keluar dari auth.' });
  }

  /** Keluar dari semua perangkat: cabut sesi aplikasi (semua app), tolak token lama, dan logout IdP. Akun tetap bisa login lagi. */
  @Post(':app/logout-all')
  async logoutAll(@Req() req: Request, @Res() res: Response) {
    const app = appFrom(String(req.params.app));
    const p = await this.principals.resolve(req, app);
    if (!p) throw E.unauthenticated();
    if (req.headers['x-lemone-request'] !== '1' && p.authMode === 'SESSION') throw E.csrf();
    const n = await this.sessions.revokeAllForUser(p.userId, 'USER_LOGOUT_ALL');
    await getDb().updateTable('directory.users').set({ tokens_not_before: new Date(), authz_version: (eb) => eb('authz_version', '+', 1) }).where('id', '=', p.userId).execute();
    if (config().AUTH_MODE === 'oidc') await getDb().insertInto('ops.provisioning_jobs').values({ kind: 'LOGOUT_ALL', user_id: p.userId, idempotency_key: `logout-all:${p.userId}:${Date.now()}`, status: 'PENDING', payload: JSON.stringify({}) }).execute();
    res.clearCookie(APPS[app].cookie, cookieOptions(app));
    await audit({ actorUserId: p.userId, action: 'auth.logout_all', details: { sessionsRevoked: n } });
    res.json({ ok: true, sessionsRevoked: n, idp: 'DIJADWALKAN' });
  }

  /** Identitas pengguna untuk aplikasi (web cookie atau Bearer). Akun pending tetap mendapat status agar UI bisa mengarahkan. */
  @Get(':app/me')
  async me(@Req() req: Request) {
    const app = appFrom(String(req.params.app));
    const p = await this.principals.resolve(req, app);
    if (!p) throw E.unauthenticated();
    return {
      userId: p.userId,
      username: p.username,
      displayName: p.displayName,
      employeeId: p.employeeId,
      status: p.status,
      roles: p.roles,
      grants: p.grants,
      hrDivisions: p.hrDivisions,
      canUseApp: p.status === 'ACTIVE' && p.grants.includes(app),
      authMode: p.authMode,
      idpConfigured: config().AUTH_MODE === 'oidc' && idp().configured,
      loginMode: config().AUTH_MODE,
      erpLabel: config().ERP_ADAPTER === 'demo' ? 'DEMO' : 'ERP',
    };
  }
}
