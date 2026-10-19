import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { parse as parseCookie } from 'cookie';
import { z } from 'zod';
import { AllowPending, cookieOptions, CurrentUser, Public, RequireApp, type Principal } from '../auth/principal';
import { E } from '../common/errors';
import { decryptJson, encryptJson } from '../common/crypto';
import { config } from '../config';
import { getDb } from '../db/db';
import { erp } from '../erp/erp.provider';
import { idp } from '../idp/keycloak-admin';
import { AccountsService } from './accounts.service';
import { ActivationService } from './activation.service';

const zApp = z.enum(['CHAT', 'WORK']);
const zRole = z.enum(['OWNER', 'ACCOUNT_ADMIN', 'HR', 'APPROVER', 'EMPLOYEE']);
const zDelivery = z.enum(['HR_HANDOVER', 'EMAIL']);

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
  const r = schema.safeParse(body);
  if (!r.success) throw E.invalid(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

/** Portal lemone.work/user: hanya pemegang grant WORK dan peran pengelola. */
@Controller('work')
@RequireApp('WORK')
export class WorkController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}

  @Get('status')
  async status() {
    const [users, pending, review] = await Promise.all([
      getDb().selectFrom('directory.users').select((eb) => eb.fn.countAll().as('n')).where('kind', '=', 'HUMAN').executeTakeFirstOrThrow(),
      getDb().selectFrom('directory.users').select((eb) => eb.fn.countAll().as('n')).where('status', '=', 'PENDING_ACTIVATION').executeTakeFirstOrThrow(),
      getDb().selectFrom('ops.provisioning_jobs').select((eb) => eb.fn.countAll().as('n')).where('status', '=', 'NEEDS_REVIEW').executeTakeFirstOrThrow(),
    ]);
    return {
      erp: { adapter: erp().name, label: erp().label, connected: erp().connected, status: erp().connected ? 'TERHUBUNG' : 'BELUM_TERHUBUNG' },
      idp: { configured: idp().configured, issuer: config().OIDC_ISSUER },
      email: { status: 'BELUM_TERHUBUNG' },
      push: { status: 'BELUM_TERHUBUNG' },
      ai: { provider: config().AI_PROVIDER, status: config().AI_PROVIDER === 'none' ? 'BELUM_TERHUBUNG' : 'TERHUBUNG' },
      counts: { users: Number(users.n), pending: Number(pending.n), needsReview: Number(review.n) },
    };
  }

  @Get('employees')
  employees(@CurrentUser() me: Principal, @Query('q') q = '') {
    return this.accounts.searchEmployees(me, q);
  }

  @Get('accounts')
  list(@CurrentUser() me: Principal, @Query('q') q?: string, @Query('division') division?: string, @Query('status') status?: string, @Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    return this.accounts.list(me, { q, division, status, page: Math.max(1, Number(page) || 1), pageSize: Math.min(100, Math.max(5, Number(pageSize) || 20)) });
  }

  @Post('accounts')
  create(@CurrentUser() me: Principal, @Body() body: unknown) {
    const input = parse(
      z.object({
        employeeId: z.string().min(1),
        username: z.string().min(3).max(32),
        apps: z.array(zApp).min(1),
        delivery: zDelivery.default('HR_HANDOVER'),
        roles: z.array(z.object({ role: zRole, scope: z.array(z.string()).nullable() })).optional(),
      }),
      body,
    );
    return this.accounts.create(me, input);
  }

  @Get('accounts/:id')
  detail(@CurrentUser() me: Principal, @Param('id') id: string) {
    return this.accounts.detail(me, id);
  }

  @Post('accounts/:id/invitation')
  reissue(@CurrentUser() me: Principal, @Param('id') id: string, @Body() body: unknown) {
    const { delivery } = parse(z.object({ delivery: zDelivery.default('HR_HANDOVER') }), body ?? {});
    return this.accounts.reissueInvitation(me, id, delivery);
  }

  @Delete('accounts/:id/invitation')
  revokeInvitation(@CurrentUser() me: Principal, @Param('id') id: string) {
    return this.accounts.revokeInvitation(me, id);
  }

  @Post('accounts/:id/grants')
  grant(@CurrentUser() me: Principal, @Param('id') id: string, @Body() body: unknown) {
    const { app, enable } = parse(z.object({ app: zApp, enable: z.boolean() }), body);
    return this.accounts.setGrant(me, id, app, enable);
  }

  @Post('accounts/:id/roles')
  role(@CurrentUser() me: Principal, @Param('id') id: string, @Body() body: unknown) {
    const { role, scope } = parse(z.object({ role: zRole, scope: z.array(z.string()).nullable().default(null) }), body);
    return this.accounts.assignRole(me, id, role, scope);
  }

  @Delete('accounts/:id/roles/:role')
  revokeRole(@CurrentUser() me: Principal, @Param('id') id: string, @Param('role') role: string) {
    return this.accounts.revokeRole(me, id, parse(zRole, role));
  }

  @Post('accounts/:id/disable')
  disable(@CurrentUser() me: Principal, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(z.object({ reason: z.string().min(2).max(200) }), body);
    return this.accounts.disable(me, id, reason);
  }

  @Post('accounts/:id/reactivate')
  reactivate(@CurrentUser() me: Principal, @Param('id') id: string) {
    return this.accounts.reactivate(me, id);
  }

  @Delete('accounts/:id/sessions/:sid')
  revokeSession(@CurrentUser() me: Principal, @Param('id') id: string, @Param('sid') sid: string) {
    return this.accounts.revokeSession(me, id, sid);
  }

  @Post('accounts/:id/logout-all')
  logoutAll(@CurrentUser() me: Principal, @Param('id') id: string) {
    return this.accounts.logoutAllDevices(me, id);
  }

  @Post('accounts/:id/recovery')
  recovery(@CurrentUser() me: Principal, @Param('id') id: string) {
    return this.accounts.startRecovery(me, id);
  }

  @Get('audit')
  async audit(@CurrentUser() me: Principal, @Query('limit') limit = '50') {
    if (!me.roles.some((r) => r.role === 'OWNER' || r.role === 'ACCOUNT_ADMIN')) throw E.forbidden();
    return getDb().selectFrom('ops.audit_events').selectAll().orderBy('at', 'desc').limit(Math.min(200, Number(limit) || 50)).execute();
  }
}

/** Aktivasi akun: publik, tanpa sesi. Token hanya lewat body POST, tidak pernah di log. */
@Controller('activation')
@Public()
export class ActivationController {
  constructor(@Inject(ActivationService) private readonly activation: ActivationService) {}

  @Post('inspect')
  inspect(@Body() body: unknown) {
    const { token } = parse(z.object({ token: z.string().min(1).max(200) }), body);
    return this.activation.inspect(token);
  }

  /** Reservasi undangan dan beri cookie konteks aktivasi; token dibersihkan dari URL oleh frontend. */
  @Post('begin')
  async begin(@Req() req: Request, @Res() res: Response, @Body() body: unknown) {
    const { token } = parse(z.object({ token: z.string().min(1).max(200) }), body);
    const resume = readActivationCookie(req);
    const r = await this.activation.begin(token, resume);
    if (!r.ok) return res.status(409).json({ ok: false, status: r.reason });
    res.cookie('lact', encryptJson({ a: r.activationId, t: Date.now() }).toString('base64url'), { ...cookieOptions('WORK'), maxAge: config().ACTIVATION_TTL_MINUTES * 60_000 });
    await this.activation.markAwaitingIdp(r.activationId);
    return res.json({ ok: true, activationId: r.activationId, username: r.username, loginUrl: `/api/auth/work/login?activation=${r.activationId}&login_hint=${encodeURIComponent(r.username)}` });
  }

  /** Status konteks aktivasi pemegang cookie (untuk halaman mismatch/resume). */
  @Get('context')
  async context(@Req() req: Request) {
    const a = readActivationCookie(req);
    if (!a) return { active: false };
    const act = await getDb().selectFrom('directory.activations as a').innerJoin('directory.users as u', 'u.id', 'a.user_id').select(['a.id', 'a.status', 'a.expires_at', 'u.username']).where('a.id', '=', a).executeTakeFirst();
    if (!act || act.expires_at.getTime() < Date.now()) return { active: false };
    return { active: true, activationId: act.id, status: act.status, username: act.username, loginUrl: `/api/auth/work/login?activation=${act.id}&login_hint=${encodeURIComponent(act.username)}&prompt=login` };
  }
}

function readActivationCookie(req: Request): string | null {
  const raw = parseCookie(req.headers.cookie ?? '')['lact'];
  if (!raw) return null;
  try {
    const v = decryptJson<{ a: string; t: number }>(Buffer.from(raw, 'base64url'));
    return v.a;
  } catch {
    return null;
  }
}

/** Info diri untuk akun yang belum aktif (dipakai halaman "akun belum aktif"). */
@Controller('me')
export class MeController {
  @Get('work')
  @RequireApp('WORK')
  @AllowPending()
  work(@CurrentUser() me: Principal) {
    return { userId: me.userId, username: me.username, status: me.status, grants: me.grants };
  }
}
