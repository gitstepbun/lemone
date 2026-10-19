/**
 * Uji UI dengan Chromium headless (Playwright): aktivasi → Chat (SSO) → pengajuan izin → portal Work → Buat akun.
 * Prasyarat: API :4000, worker, work-web :3001, chat-web :3002, Keycloak. Jalankan:
 *   npx playwright install chromium   (sekali)
 *   pnpm --filter @lemone/api test:ui
 * Bukti: tangkapan layar di docs/bukti/*.png.
 */
import 'reflect-metadata';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb, getPool } from '../../src/db/db';
import { enqueueJob, runJobInline } from '../../src/provisioning/jobs';
import { idp } from '../../src/idp/keycloak-admin';
import { config } from '../../src/config';
import '../../src/provisioning/handlers';

const OUT = resolve(__dirname, '../../../../docs/bukti');
mkdirSync(OUT, { recursive: true });
const RUN = Date.now().toString(36).slice(-4);

async function provision(username: string, employeeId: string, hr: boolean) {
  const db = getDb();
  const emp = await db.selectFrom('ops.erp_demo_employees').selectAll().where('employee_id', '=', employeeId).executeTakeFirstOrThrow();
  const old = await db.selectFrom('directory.users').select(['id', 'idp_user_ref']).where('employee_id', '=', employeeId).executeTakeFirst();
  if (old) {
    if (old.idp_user_ref) await kcDelete(old.idp_user_ref);
    for (const t of ['UPDATE directory.invitations SET created_by=NULL WHERE created_by=$1', 'UPDATE directory.application_grants SET granted_by=NULL WHERE granted_by=$1', 'UPDATE directory.role_assignments SET assigned_by=NULL WHERE assigned_by=$1', 'UPDATE directory.hr_assignments SET assigned_by=NULL WHERE assigned_by=$1', 'DELETE FROM hr.leave_request_history WHERE request_id IN (SELECT id FROM hr.leave_requests WHERE employee_user_id=$1 OR decided_by=$1)', 'DELETE FROM hr.leave_requests WHERE employee_user_id=$1 OR decided_by=$1', 'DELETE FROM chat.messages WHERE sender_user_id=$1 OR via_service_user_id=$1 OR conversation_id IN (SELECT id FROM chat.conversations WHERE dm_key LIKE \'%\' || $1)', 'DELETE FROM chat.participants WHERE user_id=$1 OR conversation_id IN (SELECT id FROM chat.conversations WHERE dm_key LIKE \'%\' || $1)', 'DELETE FROM chat.conversations WHERE dm_key LIKE \'%\' || $1', 'DELETE FROM directory.application_sessions WHERE user_id=$1', 'DELETE FROM directory.device_registrations WHERE user_id=$1', 'DELETE FROM directory.activations WHERE invitation_id IN (SELECT id FROM directory.invitations WHERE user_id=$1)', 'DELETE FROM directory.invitations WHERE user_id=$1', 'DELETE FROM directory.application_grants WHERE user_id=$1', 'DELETE FROM directory.role_assignments WHERE user_id=$1', 'DELETE FROM directory.hr_assignments WHERE hr_user_id=$1', 'DELETE FROM directory.identity_bindings WHERE user_id=$1', 'DELETE FROM ops.provisioning_jobs WHERE user_id=$1', 'DELETE FROM directory.users WHERE id=$1']) await getPool().query(t, [old.id]);
  }
  await db.insertInto('directory.employee_directory').values({ org_id: 'lemone', employee_id: emp.employee_id, full_name: emp.full_name, division: emp.division, position: emp.position, manager_employee_id: emp.manager_employee_id, location: emp.location, work_status: 'ACTIVE', email: null, phone: null, source: 'DEMO', source_version: '1' }).onConflict((oc) => oc.columns(['org_id', 'employee_id']).doNothing()).execute();
  const u = await db.insertInto('directory.users').values({ org_id: 'lemone', employee_id: employeeId, username, display_name: emp.full_name, kind: 'HUMAN', status: 'PENDING_ACTIVATION' }).returning('id').executeTakeFirstOrThrow();
  for (const app of ['WORK', 'CHAT'] as const) await db.insertInto('directory.application_grants').values({ user_id: u.id, app, status: 'PENDING' }).execute();
  for (const role of (hr ? ['HR', 'EMPLOYEE'] : ['EMPLOYEE']) as Array<'HR' | 'EMPLOYEE'>) await db.insertInto('directory.role_assignments').values({ user_id: u.id, role, scope_divisions: null }).execute();
  if (hr) await db.insertInto('directory.hr_assignments').values({ hr_user_id: u.id, divisions: null }).execute();
  const run = await runJobInline(await enqueueJob({ kind: 'PROVISION_ACCOUNT', userId: u.id, idempotencyKey: `provision:${u.id}`, payload: { delivery: 'HR_HANDOVER' } }));
  if (run.status !== 'DONE') throw new Error(`provisioning gagal ${run.stage} ${run.error}`);
  return { token: run.ephemeral.invitationToken as string, temp: run.ephemeral.temporaryPassword as string };
}

async function main() {
  const pwMod = await import(process.env.PW_MODULE ?? 'playwright');
  const pw = (pwMod.chromium ? pwMod : pwMod.default) as { chromium: { launch: () => Promise<any> } };
  const username = `ui.rina.${RUN}`;
  const { token, temp } = await provision(username, 'EMP-0002', true);
  const sari = await provision(`ui.sari.${RUN}`, 'EMP-0004', false);
  // bersihkan akun uji untuk wizard
  await getPool().query(`DELETE FROM directory.application_grants WHERE user_id IN (SELECT id FROM directory.users WHERE employee_id='EMP-0010')`);
  await getPool().query(`DELETE FROM directory.activations WHERE user_id IN (SELECT id FROM directory.users WHERE employee_id='EMP-0010')`);
  await getPool().query(`DELETE FROM directory.invitations WHERE user_id IN (SELECT id FROM directory.users WHERE employee_id='EMP-0010')`);
  await getPool().query(`DELETE FROM directory.role_assignments WHERE user_id IN (SELECT id FROM directory.users WHERE employee_id='EMP-0010')`);
  await getPool().query(`DELETE FROM ops.provisioning_jobs WHERE user_id IN (SELECT id FROM directory.users WHERE employee_id='EMP-0010')`);
  await getPool().query(`DELETE FROM directory.users WHERE employee_id='EMP-0010'`);
  const stale = await idp().findByUsername('yusuf.hidayat');
  if (stale) await kcDelete(stale.id);

  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, locale: 'id-ID' });
  const page = await ctx.newPage();
  const shot = (n: string) => page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
  const results: string[] = [];
  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); results.push(`PASS ${name}`); console.log('PASS', name); }
    catch (e) { results.push(`FAIL ${name}: ${(e as Error).message.slice(0, 200)}`); console.log('FAIL', name, (e as Error).message.slice(0, 300)); await shot(`gagal-${name.replace(/\W+/g, '-')}`); }
  };

  await step('01 Halaman aktivasi membaca undangan tanpa token di URL', async () => {
    await page.goto(`http://localhost:3001/activate?t=${token}`);
    await page.getByRole('button', { name: 'Aktifkan akun' }).waitFor({ timeout: 20000 });
    if (page.url().includes('t=')) throw new Error('token masih di URL');
    await shot('01-aktivasi');
  });
  await step('02 Aktifkan akun → login IdP (sandi sementara) → ganti sandi → Akun aktif', async () => {
    await page.getByRole('button', { name: 'Aktifkan akun' }).click();
    await page.waitForURL(/localhost:8080\/realms\/lemone/, { timeout: 20000 });
    await shot('02-login-idp');
    await page.fill('#password', temp);
    await page.click('#kc-login');
    await page.waitForSelector('#password-new', { timeout: 20000 });
    await page.fill('#password-new', 'RinaBaru!2026');
    await page.fill('#password-confirm', 'RinaBaru!2026');
    await shot('03-ganti-sandi');
    await page.click('button[type=submit]');
    await page.waitForURL(/localhost:3001\/activate\?status=done/, { timeout: 20000 });
    await page.getByText('Akun aktif').waitFor();
    await shot('04-akun-aktif');
  });
  await step('03 Buka Lemone Chat → Masuk dengan akun Lemone (SSO, tanpa sandi lagi) → daftar chat dengan @hr', async () => {
    await page.goto('http://localhost:3002/masuk');
    await page.getByText('Masuk dengan akun Lemone').click();
    await page.waitForURL(/localhost:3002\/(\?.*)?$/, { timeout: 30000 });
    await page.getByText('@hr', { exact: false }).first().waitFor({ timeout: 20000 });
    await shot('05-chat-daftar');
  });
  await step('04 Kirim "izin tidak masuk besok" ke @hr → kartu pengajuan Menunggu persetujuan', async () => {
    await page.getByText('@hr', { exact: true }).first().click();
    await page.waitForURL(/\/c\//, { timeout: 20000 });
    const box = page.locator('textarea, input[type=text]').last();
    await box.fill('Saya izin tidak masuk besok karena urusan keluarga');
    await box.press('Enter');
    await page.getByText('Menunggu persetujuan').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Batalkan' }).waitFor();
    await shot('06-kartu-izin');
  });
  await step('05 Tab Saya menampilkan pengajuan dan jadwal (DEMO)', async () => {
    await page.goto('http://localhost:3002/saya');
    await page.getByText('Pengajuan saya').waitFor({ timeout: 20000 });
    await page.getByText('DEMO', { exact: false }).first().waitFor();
    await shot('07-saya');
  });
  await step('06 Portal Work: daftar akun & status koneksi', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('http://localhost:3001/masuk');
    await page.getByText('Masuk dengan akun Lemone').click();
    await page.waitForURL(/localhost:3001\/user/, { timeout: 30000 });
    await page.getByRole('button', { name: 'Buat akun' }).or(page.getByRole('link', { name: 'Buat akun' })).first().waitFor({ timeout: 20000 });
    await page.getByText('Belum terhubung', { exact: false }).first().waitFor();
    await page.getByText('Menunggu aktivasi').or(page.getByText('Aktif', { exact: true })).first().waitFor({ timeout: 20000 });
    await shot('08-work-daftar');
  });
  await step('07 Buat akun 5 langkah untuk Yusuf (EMP-0010) → kredensial sekali-tampil', async () => {
    await page.goto('http://localhost:3001/user/baru');
    const search = page.locator('input').first();
    await search.fill('Yusuf');
    await page.getByText('EMP-0010', { exact: false }).first().click();
    await shot('09-wizard-1');
    // langkah 2..5: tombol Lanjut
    for (let i = 0; i < 4; i++) {
      const next = page.getByRole('button', { name: /^(Lanjut|Berikutnya)$/ });
      if (await next.count()) { await next.first().click(); await page.waitForTimeout(300); }
    }
    await shot('10-wizard-ringkasan');
    await page.getByRole('button', { name: 'Buat undangan' }).click();
    await page.getByText('Tampil sekali', { exact: false }).waitFor({ timeout: 30000 });
    await shot('11-handover');
  });
  await step('08 Detail akun Yusuf: Menunggu aktivasi, undangan, tindakan', async () => {
    const selesai = page.getByRole('button', { name: 'Selesai' }).or(page.getByRole('link', { name: 'Selesai' }));
    await selesai.first().click();
    await page.waitForURL(/\/user\/[0-9a-f-]{36}/, { timeout: 20000 });
    await page.getByText('Menunggu aktivasi').first().waitFor();
    await page.getByText('Nonaktifkan akun').first().waitFor();
    await shot('12-detail-akun');
  });
  await step('09 Karyawan lain (Sari) aktivasi di browser terpisah dan mengirim izin ke @hr', async () => {
    const ctx2 = await browser.newContext({ viewport: { width: 420, height: 860 }, locale: 'id-ID' });
    const p2 = await ctx2.newPage();
    await p2.goto(`http://localhost:3001/activate?t=${sari.token}`);
    await p2.getByRole('button', { name: 'Aktifkan akun' }).click();
    await p2.waitForURL(/localhost:8080\/realms\/lemone/, { timeout: 20000 });
    await p2.fill('#password', sari.temp);
    await p2.click('#kc-login');
    await p2.waitForSelector('#password-new', { timeout: 20000 });
    await p2.fill('#password-new', 'SariBaru!2026');
    await p2.fill('#password-confirm', 'SariBaru!2026');
    await p2.click('button[type=submit]');
    await p2.waitForURL(/activate\?status=done/, { timeout: 20000 });
    await p2.goto('http://localhost:3002/masuk');
    await p2.getByText('Masuk dengan akun Lemone').click();
    await p2.waitForURL(/localhost:3002\/(\?.*)?$/, { timeout: 30000 });
    await p2.getByText('@hr', { exact: true }).first().click();
    await p2.waitForURL(/\/c\//, { timeout: 20000 });
    const box = p2.locator('textarea, input[type=text]').last();
    await box.fill('Saya izin tidak masuk tanggal 21 Oktober 2026 karena urusan keluarga.');
    await box.press('Enter');
    await p2.getByText('Menunggu persetujuan').waitFor({ timeout: 20000 });
    await p2.screenshot({ path: `${OUT}/13-sari-kartu.png`, fullPage: true });
    (globalThis as { p2?: unknown }).p2 = p2;
  });
  await step('10 HR (Rina) menyetujui di tab HR → Disetujui; worker mencatat ke absensi DEMO; kartu Sari terbarui lewat WebSocket', async () => {
    await page.setViewportSize({ width: 420, height: 860 });
    await page.goto('http://localhost:3002/hr');
    await page.getByText('Sari Lestari', { exact: false }).first().waitFor({ timeout: 20000 });
    await page.screenshot({ path: `${OUT}/14-hr-antrean.png`, fullPage: true });
    page.on('dialog', (d: any) => { console.log('dialog:', d.type(), d.message()); void d.accept('OK'); });
    page.on('response', (r: any) => { if (r.url().includes('/api/hr/')) console.log('resp:', r.status(), r.url()); });
    page.on('console', (m: any) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });
    await page.getByRole('button', { name: 'Setujui', exact: true }).first().click();
    await page.waitForTimeout(2500);
    const p2 = (globalThis as { p2?: any }).p2;
    await p2.waitForTimeout(4000);
    await p2.screenshot({ path: `${OUT}/15a-sari-ws.png`, fullPage: true });
    const liveWs = await p2.getByText('Disetujui').count();
    if (!liveWs) throw new Error('kartu Sari tidak terbarui lewat WebSocket');
    for (let i = 0; i < 15 && (await p2.getByText('Tercatat di absensi').count()) === 0; i++) await p2.waitForTimeout(2000);
    if ((await p2.getByText('Tercatat di absensi').count()) === 0) throw new Error('status absensi tidak menjadi Tercatat');
    await p2.screenshot({ path: `${OUT}/15-sari-disetujui.png`, fullPage: true });
    await page.goto('http://localhost:3002/hr?status=APPROVED');
    await page.screenshot({ path: `${OUT}/16-hr-disetujui.png`, fullPage: true });
  });
  await browser.close();
  await getPool().end();
  console.log('\n' + results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
}
async function kcDelete(idpUserId: string) {
  const c = config();
  const tok = await fetch(`${c.KC_ADMIN_URL}/realms/${c.KC_REALM}/protocol/openid-connect/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.IDP_PROVISIONER_CLIENT_ID, client_secret: c.IDP_PROVISIONER_CLIENT_SECRET }) });
  const { access_token } = (await tok.json()) as { access_token: string };
  await fetch(`${c.KC_ADMIN_URL}/admin/realms/${c.KC_REALM}/users/${idpUserId}`, { method: 'DELETE', headers: { authorization: `Bearer ${access_token}` } });
}
main().catch((e) => { console.error(e); process.exit(1); });
