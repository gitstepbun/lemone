import { CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { parse as parseCookie } from 'cookie';
import { APPS, config, type AppKey } from '../config';
import { E } from '../common/errors';
import { getDb } from '../db/db';
import type { AppName, Role, UserStatus } from '../db/types';
import { verifyAccessToken } from './oidc';
import { SessionService } from './session.service';

export interface Principal {
  userId: string;
  username: string;
  displayName: string;
  employeeId: string | null;
  kind: 'HUMAN' | 'SERVICE';
  status: UserStatus;
  authzVersion: number;
  roles: Array<{ role: Role; scope: string[] | null }>;
  grants: AppName[];
  hrDivisions: string[] | null | undefined; // undefined = bukan petugas HR
  sessionId: string | null;
  authMode: 'SESSION' | 'BEARER';
  app: AppKey;
}

export const APP_KEY = 'lemone:app';
export const ALLOW_PENDING = 'lemone:allowPending';
export const PUBLIC = 'lemone:public';
export const RequireApp = (app: AppKey) => SetMetadata(APP_KEY, app);
export const AllowPending = () => SetMetadata(ALLOW_PENDING, true);
export const Public = () => SetMetadata(PUBLIC, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  return (ctx.switchToHttp().getRequest() as Request & { principal: Principal }).principal;
});

@Injectable()
export class PrincipalService {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async loadUser(userId: string, app: AppKey, extra: { sessionId: string | null; authMode: Principal['authMode'] }): Promise<Principal | null> {
    const db = getDb();
    const u = await db.selectFrom('directory.users').selectAll().where('id', '=', userId).executeTakeFirst();
    if (!u) return null;
    const [roles, grants, hr] = await Promise.all([
      db.selectFrom('directory.role_assignments').select(['role', 'scope_divisions']).where('user_id', '=', userId).where('revoked_at', 'is', null).execute(),
      db.selectFrom('directory.application_grants').select('app').where('user_id', '=', userId).where('status', '=', 'ACTIVE').execute(),
      db.selectFrom('directory.hr_assignments').select('divisions').where('hr_user_id', '=', userId).where('revoked_at', 'is', null).execute(),
    ]);
    let hrDivisions: Principal['hrDivisions'] = undefined;
    if (hr.length) hrDivisions = hr.some((h) => h.divisions === null) ? null : [...new Set(hr.flatMap((h) => h.divisions ?? []))];
    return {
      userId: u.id,
      username: u.username,
      displayName: u.display_name,
      employeeId: u.employee_id,
      kind: u.kind,
      status: u.status,
      authzVersion: u.authz_version,
      roles: roles.map((r) => ({ role: r.role, scope: r.scope_divisions })),
      grants: grants.map((g) => g.app),
      hrDivisions,
      sessionId: extra.sessionId,
      authMode: extra.authMode,
      app,
    };
  }

  /** Resolusi identitas: Bearer (mobile/API) atau cookie sesi aplikasi (web BFF). */
  async resolve(req: Request, app: AppKey): Promise<Principal | null> {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ') && config().AUTH_MODE === 'oidc') {
      let payload;
      try {
        payload = await verifyAccessToken(auth.slice(7));
      } catch {
        return null;
      }
      const b = await getDb()
        .selectFrom('directory.identity_bindings')
        .select('user_id')
        .where('issuer', '=', payload.iss!)
        .where('subject', '=', String(payload.sub))
        .executeTakeFirst();
      if (!b) return null;
      const u = await getDb().selectFrom('directory.users').select('tokens_not_before').where('id', '=', b.user_id).executeTakeFirst();
      if (u?.tokens_not_before && payload.iat && payload.iat * 1000 < u.tokens_not_before.getTime()) return null;
      return this.loadUser(b.user_id, app, { sessionId: null, authMode: 'BEARER' });
    }
    const cookies = parseCookie(req.headers.cookie ?? '');
    const sid = cookies[APPS[app].cookie];
    if (!sid) return null;
    const s = await this.sessions.get(sid);
    if (!s || s.revoked_at || s.app !== app) return null;
    if (!(await this.sessions.ensureFresh(s, app))) return null;
    void this.sessions.touch(s.id);
    return this.loadUser(s.user_id, app, { sessionId: s.id, authMode: 'SESSION' });
  }
}

/** Guard global: autentikasi + status akun + grant aplikasi + CSRF untuk sesi cookie. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(PrincipalService) private readonly principals: PrincipalService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const app = this.reflector.getAllAndOverride<AppKey>(APP_KEY, targets);
    if (!app) throw new Error('Route tanpa @RequireApp/@Public');
    const req = ctx.switchToHttp().getRequest<Request & { principal: Principal }>();
    const p = await this.principals.resolve(req, app);
    if (!p) throw E.unauthenticated();
    if (p.authMode === 'SESSION' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers['x-lemone-request'] !== '1') throw E.csrf();
      const origin = (req.headers.origin as string | undefined) ?? (req.headers.referer as string | undefined);
      if (origin) {
        const allowed = new URL(APPS[app].publicUrl()).origin;
        if (new URL(origin).origin !== allowed) throw E.csrf();
      }
    }
    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING, targets);
    if (p.status === 'DISABLED') throw E.accountDisabled();
    if (p.status !== 'ACTIVE' && !allowPending) throw E.accountPending();
    if (!allowPending && !p.grants.includes(app)) throw E.noGrant(app);
    req.principal = p;
    return true;
  }
}

export function cookieOptions(app: AppKey) {
  const secure = APPS[app].publicUrl().startsWith('https://');
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
}

export function isConfigured() {
  return Boolean(config().OIDC_CLIENT_WORK_SECRET && config().OIDC_CLIENT_CHAT_SECRET);
}
