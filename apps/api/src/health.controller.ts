import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/principal';
import { config } from './config';
import { getDb, sql } from './db/db';
import { erp } from './erp/erp.provider';
import { idp } from './idp/keycloak-admin';

@Controller()
@Public()
export class HealthController {
  @Get('health')
  async health() {
    let db = 'ok';
    try { await sql`select 1`.execute(getDb()); } catch (e) { db = `gagal: ${(e as Error).message}`; }
    let idpStatus = config().AUTH_MODE === 'local' ? 'tidak_dipakai' : 'belum_terhubung';
    if (config().AUTH_MODE === 'oidc') try {
      const r = await fetch(`${config().OIDC_ISSUER}/.well-known/openid-configuration`);
      idpStatus = r.ok ? 'ok' : `http_${r.status}`;
    } catch { idpStatus = 'tidak_terjangkau'; }
    return { ok: db === 'ok', db, idp: idpStatus, idpAdmin: config().AUTH_MODE === 'local' ? 'tidak_dipakai' : idp().configured ? 'dikonfigurasi' : 'belum_terhubung', authMode: config().AUTH_MODE, erp: { adapter: erp().name, label: erp().label, connected: erp().connected }, tz: config().BUSINESS_TZ, time: new Date().toISOString() };
  }
}
