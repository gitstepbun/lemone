/**
 * Bootstrap Owner pertama (atau pemulihan saat tidak ada admin manusia aktif).
 * Syarat: BOOTSTRAP_ENABLED=true dan tidak ada OWNER aktif. Hasil: undangan + kredensial sementara dicetak sekali.
 * Pemakaian: pnpm bootstrap:owner -- --employee EMP-0001 --username stephanus
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { audit } from '../common/audit';
import { config } from '../config';
import { getDb, getPool } from '../db/db';
import { migrate } from '../db/migrate';
import { seed } from '../db/seed';
import { erp } from '../erp/erp.provider';
import { enqueueJob, runJobInline } from '../provisioning/jobs';
import { validUsername } from '../directory/permissions';
import '../provisioning/handlers';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const c = config();
  if (!c.BOOTSTRAP_ENABLED) throw new Error('BOOTSTRAP_ENABLED bukan true. Matikan lagi setelah selesai.');
  const employeeId = arg('employee');
  const username = (arg('username') ?? '').toLowerCase();
  if (!employeeId || !username) throw new Error('Butuh --employee <id> --username <nama>');
  if (!validUsername(username)) throw new Error('Username tidak valid/dilindungi');
  await migrate();
  await seed();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const db = getDb();
  const activeOwner = await db
    .selectFrom('directory.role_assignments as r')
    .innerJoin('directory.users as u', 'u.id', 'r.user_id')
    .select('u.id')
    .where('r.role', '=', 'OWNER').where('r.revoked_at', 'is', null).where('u.status', 'in', ['ACTIVE', 'PENDING_ACTIVATION'])
    .executeTakeFirst();
  if (activeOwner && !process.argv.includes('--force-recovery')) throw new Error('Sudah ada Owner aktif/menunggu aktivasi. Gunakan --force-recovery hanya untuk pemulihan terdokumentasi.');
  const emp = await erp().getEmployee(employeeId);
  if (!emp) throw new Error(`Karyawan ${employeeId} tidak ada di sumber ${erp().label}`);
  const existing = await db.selectFrom('directory.users').select(['id', 'status']).where('employee_id', '=', employeeId).executeTakeFirst();
  let userId: string;
  if (existing) {
    userId = existing.id;
    if (existing.status === 'DISABLED') throw new Error('Akun karyawan ini nonaktif');
  } else {
    await db.insertInto('directory.employee_directory').values({ org_id: 'lemone', employee_id: emp.employeeId, full_name: emp.fullName, division: emp.division, position: emp.position, manager_employee_id: emp.managerEmployeeId, location: emp.location, work_status: emp.workStatus, email: emp.email, phone: emp.phone, source: erp().label, source_version: emp.version }).onConflict((oc) => oc.columns(['org_id', 'employee_id']).doNothing()).execute();
    userId = (await db.insertInto('directory.users').values({ org_id: 'lemone', employee_id: emp.employeeId, username, display_name: emp.fullName, kind: 'HUMAN', status: 'PENDING_ACTIVATION' }).returning('id').executeTakeFirstOrThrow()).id;
  }
  for (const appName of ['WORK', 'CHAT'] as const) {
    await db.insertInto('directory.application_grants').values({ user_id: userId, app: appName, status: existing?.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING', granted_by: null }).onConflict((oc) => oc.columns(['user_id', 'app']).doUpdateSet({ status: existing?.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING', revoked_at: null })).execute();
  }
  for (const role of ['OWNER', 'EMPLOYEE'] as const) {
    const has = await db.selectFrom('directory.role_assignments').select('id').where('user_id', '=', userId).where('role', '=', role).where('revoked_at', 'is', null).executeTakeFirst();
    if (!has) await db.insertInto('directory.role_assignments').values({ user_id: userId, role, scope_divisions: null, assigned_by: null }).execute();
  }
  await audit({ actorKind: 'SYSTEM', action: 'bootstrap.owner', targetType: 'user', targetId: userId, details: { employeeId, recovery: process.argv.includes('--force-recovery') } });
  if (existing?.status === 'ACTIVE') {
    await enqueueJob({ kind: 'SYNC_IDP_ADMIN_ROLE', userId, idempotencyKey: `sync-admin-role:${userId}:${Date.now()}` });
    console.log(`Owner diberikan ke akun aktif ${username}. Role MFA IdP disinkronkan oleh worker.`);
  } else {
    const jobId = await enqueueJob({ kind: 'PROVISION_ACCOUNT', userId, idempotencyKey: `provision:${userId}`, payload: { delivery: 'HR_HANDOVER' } });
    let run = await runJobInline(jobId);
    if (run.status !== 'DONE') throw new Error(`Provisioning belum selesai: ${run.stage} ${run.error ?? ''}`);
    if (!run.ephemeral.invitationToken) {
      // Job diselesaikan worker; kredensialnya tidak pernah tercetak. Terbitkan ulang undangan + sandi sementara secara inline.
      const re = await enqueueJob({ kind: 'REISSUE_INVITATION', userId, idempotencyKey: `reissue:${userId}:${Date.now()}`, payload: { delivery: 'HR_HANDOVER' } });
      run = await runJobInline(re);
      if (run.status !== 'DONE') throw new Error(`Penerbitan ulang undangan gagal: ${run.stage} ${run.error ?? ''}`);
    }
    await enqueueJob({ kind: 'SYNC_IDP_ADMIN_ROLE', userId, idempotencyKey: `sync-admin-role:${userId}:${Date.now()}` });
    await runJobInline((await db.selectFrom('ops.provisioning_jobs').select('id').where('kind', '=', 'SYNC_IDP_ADMIN_ROLE').where('user_id', '=', userId).orderBy('created_at', 'desc').executeTakeFirstOrThrow()).id);
    console.log('\n=== SERAHKAN SEKALI, TIDAK DISIMPAN ===');
    console.log(`Username          : ${username}`);
    console.log(`Kata sandi sementara: ${run.ephemeral.temporaryPassword as string}`);
    console.log(`Aktivasi          : ${c.WORK_PUBLIC_URL}/activate?t=${run.ephemeral.invitationToken as string}`);
    console.log(`Berlaku sampai    : ${(run.ephemeral.expiresAt as Date).toISOString()}`);
    console.log('MFA (OTP) wajib saat login pertama. Setelah aktif, set BOOTSTRAP_ENABLED=false.');
  }
  await app.close();
  await getPool().end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
