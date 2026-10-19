/**
 * Uji alur penuh terhadap stack yang berjalan (Postgres + Keycloak + API :4000).
 * Jalankan: pnpm --filter @lemone/api test:e2e
 * Hasil: daftar skenario PASS/FAIL dengan bukti ringkas. Tidak mengklaim yang tidak dijalankan.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { ChatService } from '../../src/chat/chat.service';
import { getDb, getPool } from '../../src/db/db';
import { LeaveService } from '../../src/hr/leave.service';
import { idp } from '../../src/idp/keycloak-admin';
import { makeOutboxHandler } from '../../src/provisioning/outbox';
import { enqueueJob, runJobInline, workerTick } from '../../src/provisioning/jobs';
import '../../src/provisioning/handlers';
import { Browser, callbackToApi, driveKeycloak } from './browser';
import WebSocket from 'ws';

const API = 'http://localhost:4000';
const WORK = 'http://localhost:3001';
const results: Array<{ name: string; status: 'PASS' | 'FAIL' | 'NOT TESTED'; evidence: string }> = [];
const RUN = Date.now().toString(36).slice(-5);

async function scenario(name: string, fn: () => Promise<string>) {
  if (process.env.E2E_ONLY && !name.startsWith(process.env.E2E_ONLY)) return;
  try {
    const ev = await fn();
    results.push({ name, status: 'PASS', evidence: ev });
    console.log(`PASS  ${name}  (${ev})`);
  } catch (e) {
    results.push({ name, status: 'FAIL', evidence: (e as Error).message.slice(0, 300) });
    console.log(`FAIL  ${name}  → ${(e as Error).message.slice(0, 300)}`);
    if (process.env.E2E_DEBUG) console.error(e, (e as { cause?: unknown }).cause);
  }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function provisionOwner(username: string, employeeId: string) {
  const db = getDb();
  const emp = await db.selectFrom('ops.erp_demo_employees').selectAll().where('employee_id', '=', employeeId).executeTakeFirstOrThrow();
  await db.insertInto('directory.employee_directory').values({ org_id: 'lemone', employee_id: emp.employee_id, full_name: emp.full_name, division: emp.division, position: emp.position, manager_employee_id: emp.manager_employee_id, location: emp.location, work_status: emp.work_status as 'ACTIVE', email: null, phone: null, source: 'DEMO', source_version: '1' }).onConflict((oc) => oc.columns(['org_id', 'employee_id']).doNothing()).execute();
  const u = await db.insertInto('directory.users').values({ org_id: 'lemone', employee_id: employeeId, username, display_name: emp.full_name, kind: 'HUMAN', status: 'PENDING_ACTIVATION' }).returning('id').executeTakeFirstOrThrow();
  for (const app of ['WORK', 'CHAT'] as const) await db.insertInto('directory.application_grants').values({ user_id: u.id, app, status: 'PENDING' }).execute();
  for (const role of ['OWNER', 'EMPLOYEE'] as const) await db.insertInto('directory.role_assignments').values({ user_id: u.id, role, scope_divisions: null }).execute();
  const jobId = await enqueueJob({ kind: 'PROVISION_ACCOUNT', userId: u.id, idempotencyKey: `provision:${u.id}`, payload: { delivery: 'HR_HANDOVER' } });
  const run = await runJobInline(jobId);
  assert(run.status === 'DONE', `provisioning owner gagal: ${run.stage} ${run.error}`);
  const sync = await enqueueJob({ kind: 'SYNC_IDP_ADMIN_ROLE', userId: u.id, idempotencyKey: `sync-admin-role:${u.id}:e2e` });
  await runJobInline(sync);
  return { userId: u.id, token: run.ephemeral.invitationToken as string, temp: run.ephemeral.temporaryPassword as string };
}

/** Aktivasi lewat browser: begin → login IdP (ganti sandi, OTP bila perlu) → callback. */
async function activate(b: Browser, token: string, creds: { username: string; password: string; newPassword: string; totpSecret?: { value?: string } }) {
  const begin = await b.fetch(`${API}/activation/begin`, { method: 'POST', json: { token } });
  assert(begin.status === 200 || begin.status === 201, `begin gagal: ${begin.status} ${begin.text}`);
  const { loginUrl } = begin.json() as { loginUrl: string };
  const drive = await driveKeycloak(b, `${API}${loginUrl.replace('/api', '')}`, creds);
  assert(drive.callbackUrl, `tidak sampai callback: ${drive.steps.join(' > ')}`);
  const cb = await b.fetch(callbackToApi(drive.callbackUrl, 'work'));
  return { status: cb.status, location: cb.location, steps: drive.steps };
}

/** Login ke aplikasi (work/chat) memakai sesi SSO di browser atau kredensial. */
async function login(b: Browser, app: 'work' | 'chat', creds: { username: string; password: string; totpSecret?: { value?: string } }) {
  const drive = await driveKeycloak(b, `${API}/auth/${app}/login?return=/`, creds);
  assert(drive.callbackUrl, `login ${app} tidak sampai callback: ${drive.steps.join(' > ')}`);
  const cb = await b.fetch(callbackToApi(drive.callbackUrl, app));
  return { status: cb.status, location: cb.location, steps: drive.steps };
}

async function main() {
  const health = await (await fetch(`${API}/health`)).json() as { ok: boolean };
  assert(health.ok, 'API tidak sehat');
  const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const outbox = makeOutboxHandler(ctx.get(ChatService), ctx.get(LeaveService));
  const tick = async () => { for (let i = 0; i < 5; i++) await workerTick('e2e-worker', outbox); };
  const db = getDb();

  // Bersihkan akun uji dari run sebelumnya di IdP (DB memakai username ber-suffix RUN)
  const OWNER = `e2e.owner.${RUN}`; const SARI = `sari.${RUN}`; const RINA = `rina.${RUN}`; const DEDI = `dedi.${RUN}`; const OWNER2 = `e2e.owner2.${RUN}`;
  for (const emp of ['EMP-0009', 'EMP-0004', 'EMP-0002', 'EMP-0005', 'EMP-0007', 'EMP-0006']) {
    const old = await db.selectFrom('directory.users').select(['id', 'idp_user_ref']).where('employee_id', '=', emp).executeTakeFirst();
    if (old) {
      const { sql } = await import('kysely');
      for (const t of ['UPDATE directory.invitations SET created_by = NULL WHERE created_by = $1', 'UPDATE directory.invitations SET revoked_by = NULL WHERE revoked_by = $1', 'UPDATE directory.application_grants SET granted_by = NULL WHERE granted_by = $1', 'UPDATE directory.application_grants SET revoked_by = NULL WHERE revoked_by = $1', 'UPDATE directory.role_assignments SET assigned_by = NULL WHERE assigned_by = $1', 'UPDATE directory.role_assignments SET revoked_by = NULL WHERE revoked_by = $1', 'UPDATE directory.hr_assignments SET assigned_by = NULL WHERE assigned_by = $1', 'UPDATE chat.conversations SET created_by = NULL WHERE created_by = $1', 'DELETE FROM chat.participants WHERE conversation_id IN (SELECT id FROM chat.conversations WHERE dm_key LIKE \'%\' || $1)', 'DELETE FROM chat.messages WHERE conversation_id IN (SELECT id FROM chat.conversations WHERE dm_key LIKE \'%\' || $1)']) {
        await getPool().query(t, [old.id]);
      }
      for (const t of ['hr.leave_request_history WHERE request_id IN (SELECT id FROM hr.leave_requests WHERE employee_user_id = $1 OR decided_by = $1)', 'hr.leave_requests WHERE employee_user_id = $1 OR decided_by = $1', 'chat.messages WHERE sender_user_id = $1 OR via_service_user_id = $1', 'chat.participants WHERE user_id = $1', 'directory.application_sessions WHERE user_id = $1', 'directory.device_registrations WHERE user_id = $1', 'directory.activations WHERE user_id = $1', 'directory.invitations WHERE user_id = $1', 'directory.application_grants WHERE user_id = $1', 'directory.role_assignments WHERE user_id = $1', 'directory.hr_assignments WHERE hr_user_id = $1', 'directory.identity_bindings WHERE user_id = $1', 'ops.provisioning_jobs WHERE user_id = $1', 'chat.conversations WHERE dm_key LIKE \'%\' || $1', 'directory.users WHERE id = $1']) {
        await getPool().query(`DELETE FROM ${t}`, [old.id]);
      }
      void sql;
      if (old.idp_user_ref) await fetchKcDelete(old.idp_user_ref);
    }
  }
  await db.updateTable('ops.erp_demo_employees').set({ work_status: 'ACTIVE' }).where('employee_id', '=', 'EMP-0004').execute();

  const ownerB = new Browser('owner'); const sariB = new Browser('sari'); const rinaB = new Browser('rina'); const owner2B = new Browser('owner2');
  const ownerTotp: { value?: string } = {}; const owner2Totp: { value?: string } = {};
  const ownerCreds = { username: OWNER, password: '', newPassword: 'OwnerSandi!2026', totpSecret: ownerTotp };
  let ownerId = ''; let sariId = ''; let rinaId = ''; let sariToken = ''; let sariTemp = ''; let requestId = ''; let hrConvId = '';
  const workApi = ownerB.api(API); const sariApi = sariB.api(API); const rinaApi = rinaB.api(API);
  const WORK_HDR = { origin: WORK }; const CHAT_HDR = { origin: 'http://localhost:3002' };

  await scenario('S1 Owner: provisioning → aktivasi (ganti sandi + OTP wajib) → masuk portal Work', async () => {
    const p = await provisionOwner(OWNER, 'EMP-0009');
    ownerId = p.userId; ownerCreds.password = p.temp;
    const a = await activate(ownerB, p.token, ownerCreds);
    assert(a.status === 302 && a.location?.includes('/activate?status=done'), `aktivasi: ${a.status} ${a.location} ${a.steps.join('>')}`);
    assert(a.steps.includes('configure OTP'), `OTP tidak diminta untuk owner: ${a.steps.join('>')}`);
    const u = await db.selectFrom('directory.users').select('status').where('id', '=', ownerId).executeTakeFirstOrThrow();
    assert(u.status === 'ACTIVE', 'owner belum ACTIVE');
    const l = await login(ownerB, 'work', { ...ownerCreds, password: ownerCreds.newPassword });
    assert(l.status === 302 && ownerB.cookie('lw_sid'), `login work: ${l.status} ${l.location}`);
    const me = await workApi('/auth/work/me');
    assert(me.status === 200 && (me.json() as { canUseApp: boolean }).canUseApp, `me: ${me.text}`);
    return `langkah: ${a.steps.join(' > ')}`;
  });

  await scenario('S2 Owner membuat akun Sari (CHAT) → kredensial sekali-tampil; inspect tidak mengonsumsi undangan', async () => {
    const emps = await workApi('/work/employees?q=Sari', { headers: WORK_HDR });
    assert(emps.status === 200, `employees: ${emps.text}`);
    const r = await workApi('/work/accounts', { method: 'POST', headers: WORK_HDR, json: { employeeId: 'EMP-0004', username: SARI, apps: ['CHAT'], delivery: 'HR_HANDOVER' } });
    assert(r.status === 201 || r.status === 200, `create: ${r.status} ${r.text}`);
    const j = r.json() as { userId: string; jobStatus: string; handover: { activationUrl: string; temporaryPassword: string } };
    assert(j.jobStatus === 'DONE' && j.handover?.temporaryPassword, `job ${j.jobStatus}: ${r.text.slice(0, 200)}`);
    sariId = j.userId; sariTemp = j.handover.temporaryPassword; sariToken = new URL(j.handover.activationUrl).searchParams.get('t')!;
    const ins = await sariB.fetch(`${API}/activation/inspect`, { method: 'POST', json: { token: sariToken } });
    assert((ins.json() as { status: string }).status === 'VALID', `inspect: ${ins.text}`);
    const inv = await db.selectFrom('directory.invitations').select('status').where('user_id', '=', sariId).executeTakeFirstOrThrow();
    assert(inv.status === 'PENDING', `inspect mengubah status jadi ${inv.status}`);
    const bad = await sariB.fetch(`${API}/activation/inspect`, { method: 'POST', json: { token: `${sariToken}x` } });
    assert((bad.json() as { status: string }).status === 'INVALID', 'token salah diterima');
    const stored = await db.selectFrom('ops.provisioning_jobs').select('result').where('user_id', '=', sariId).executeTakeFirstOrThrow();
    assert(!JSON.stringify(stored.result).includes(sariTemp), 'kata sandi sementara tersimpan di DB');
    return `temp cred hanya di respons; invitation ${inv.status}`;
  });

  await scenario('S3 Kredensial sementara di IdP tidak membuka API sebelum aktivasi; CSRF ditolak tanpa header', async () => {
    const tmp = new Browser('sari-direct');
    const drive = await driveKeycloak(tmp, `${API}/auth/chat/login?return=/`, { username: SARI, password: sariTemp, newPassword: 'SariSandi!2026' });
    assert(drive.callbackUrl, `login langsung: ${drive.steps.join('>')}`);
    const cb = await tmp.fetch(callbackToApi(drive.callbackUrl, 'chat'));
    assert(cb.status === 302 && cb.location?.includes('/akun-belum-aktif'), `diharapkan akun-belum-aktif, dapat ${cb.location}`);
    sariTemp = 'SariSandi!2026';
    assert(!tmp.cookie('lc_sid'), 'sesi Chat terbit untuk akun pending');
    const me = await tmp.fetch(`${API}/chat/me`);
    assert(me.status === 401, `chat/me untuk pending: ${me.status}`);
    // CSRF: pakai sesi owner tanpa header anti-CSRF
    const csrf = await ownerB.fetch(`${API}/work/accounts/${sariId}/grants`, { method: 'POST', json: { app: 'CHAT', enable: true } });
    assert(csrf.status === 403 && csrf.text.includes('CSRF'), `csrf: ${csrf.status} ${csrf.text}`);
    // password Sari sekarang sudah diganti di IdP; aktivasi tetap wajib lewat undangan
    sariTemp = 'SariSandi!2026';
    return 'login IdP langsung → akun-belum-aktif, tanpa sesi; CSRF 403';
  });

  await scenario('S4 Sari mengaktifkan akun lewat undangan → ACTIVE → masuk Chat (SSO) → pesan tersimpan', async () => {
    const a = await activate(sariB, sariToken, { username: SARI, password: sariTemp, newPassword: sariTemp });
    assert(a.status === 302 && a.location?.includes('status=done'), `aktivasi: ${a.status} ${a.location}`);
    const again = await sariB.fetch(`${API}/activation/begin`, { method: 'POST', json: { token: sariToken } });
    assert(again.status === 409 && (again.json() as { status: string }).status === 'USED', `token dipakai ulang: ${again.text}`);
    const l = await login(sariB, 'chat', { username: SARI, password: sariTemp });
    assert(l.status === 302 && sariB.cookie('lc_sid'), `login chat: ${l.status} ${l.location} ${l.steps.join('>')}`);
    assert(!l.steps.includes('login form'), `SSO tidak dipakai, login form muncul lagi: ${l.steps.join('>')}`);
    const me = await sariApi('/chat/me');
    assert(me.status === 200, `chat/me: ${me.text}`);
    const convs = await sariApi('/chat/conversations');
    const list = convs.json() as Array<{ id: string; type: string }>;
    hrConvId = list.find((c) => c.type === 'HR_INBOX')!.id;
    assert(hrConvId, 'inbox @hr tidak ada');
    return `SSO: ${l.steps.join(' > ')}; inbox HR ${hrConvId.slice(0, 8)}`;
  });

  await scenario('S5 Owner membuat akun Rina (CHAT+WORK, peran HR divisi Produksi+HR) → aktivasi → login Chat', async () => {
    const r = await workApi('/work/accounts', { method: 'POST', headers: WORK_HDR, json: { employeeId: 'EMP-0002', username: RINA, apps: ['CHAT', 'WORK'], delivery: 'EMAIL', roles: [{ role: 'HR', scope: ['Produksi', 'HR'] }] } });
    assert(r.status < 300, `create rina: ${r.text}`);
    const j = r.json() as { userId: string; jobStatus: string; handover: { activationUrl: string; temporaryPassword: string; emailStatus: string } };
    assert(j.handover.emailStatus === 'BELUM_TERHUBUNG', 'email harus BELUM_TERHUBUNG');
    rinaId = j.userId;
    const tok = new URL(j.handover.activationUrl).searchParams.get('t')!;
    const a = await activate(rinaB, tok, { username: RINA, password: j.handover.temporaryPassword, newPassword: 'RinaSandi!2026' });
    assert(a.status === 302 && a.location?.includes('status=done'), `aktivasi rina: ${a.location}`);
    await tick(); // outbox: ACCOUNT_ACTIVATED + HR_ASSIGNED → inbox officers
    const l = await login(rinaB, 'chat', { username: RINA, password: 'RinaSandi!2026' });
    assert(l.status === 302 && rinaB.cookie('lc_sid'), `login chat rina: ${l.location}`);
    const me = (await rinaApi('/chat/me')).json() as { isHr: boolean };
    assert(me.isHr, 'rina bukan HR');
    const p = await db.selectFrom('chat.participants').select('role').where('conversation_id', '=', hrConvId).where('user_id', '=', rinaId).executeTakeFirst();
    assert(p?.role === 'OFFICER', `rina bukan OFFICER di inbox sari: ${JSON.stringify(p)}`);
    return 'Rina HR OFFICER pada inbox @hr milik Sari';
  });

  await scenario('S6 Deteksi izin: kalimat jelas → PENDING_APPROVAL + kartu Ubah/Batalkan; "izin tanya" & terusan tidak jadi pengajuan', async () => {
    const send = (body: string, extra: Record<string, unknown> = {}) => sariApi(`/chat/conversations/${hrConvId}/messages`, { method: 'POST', headers: CHAT_HDR, json: { clientMsgId: crypto.randomUUID(), body, ...extra } });
    const q = await send('Izin tanya, sisa cuti tahunan saya berapa ya?');
    assert((q.json() as { detection: { intent: string } }).detection.intent === 'QUESTION', `izin tanya: ${q.text.slice(0, 200)}`);
    const f = await send('Saya izin tidak masuk tanggal 21 Oktober 2026 karena urusan keluarga.', { forwarded: true });
    assert((f.json() as { detection: { intent: string } }).detection.intent === 'NONE', 'pesan terusan jadi pengajuan');
    const r = await send('Saya izin tidak masuk tanggal 21 Oktober 2026 karena urusan keluarga.');
    const det = (r.json() as { detection: { intent: string; requestId: string } }).detection;
    assert(det.intent === 'LEAVE_REQUEST' && det.requestId, `deteksi: ${r.text.slice(0, 300)}`);
    requestId = det.requestId;
    const row = await db.selectFrom('hr.leave_requests').selectAll().where('id', '=', requestId).executeTakeFirstOrThrow();
    assert(row.status === 'PENDING_APPROVAL' && row.date_from === '2026-10-21' && row.type === 'IZIN' && row.reason?.includes('urusan keluarga'), JSON.stringify(row));
    const msgs = (await sariApi(`/chat/conversations/${hrConvId}/messages`)).json() as Array<{ kind: string; payload: { card?: string; actions?: string[] } }>;
    const card = msgs.find((m) => m.kind === 'CARD' && m.payload.card === 'LEAVE_REQUEST');
    assert(card && card.payload.actions?.includes('UBAH') && card.payload.actions.includes('BATALKAN'), 'kartu tanpa tombol Ubah/Batalkan');
    const amb = await send('izin ya');
    assert((amb.json() as { detection: { intent: string } }).detection.intent === 'NEEDS_INFO', `ambigu: ${amb.text.slice(0, 200)}`);
    const fill = await send('besok');
    assert((fill.json() as { detection: { intent: string; requestId: string } }).detection.intent === 'LEAVE_REQUEST', `pelengkapan: ${fill.text.slice(0, 200)}`);
    const n = await db.selectFrom('hr.leave_requests').select((eb) => eb.fn.countAll().as('n')).where('employee_user_id', '=', sariId).where('status', '=', 'PENDING_APPROVAL').executeTakeFirstOrThrow();
    assert(Number(n.n) === 2, `pengajuan pending: ${n.n}`);
    return `request ${requestId.slice(0, 8)} IZIN 2026-10-21; pelengkapan "besok" OK`;
  });

  await scenario('S7 Pesan idempoten & persisten; bukan anggota ditolak', async () => {
    const cid = crypto.randomUUID();
    const a = await sariApi(`/chat/conversations/${hrConvId}/messages`, { method: 'POST', headers: CHAT_HDR, json: { clientMsgId: cid, body: 'Terima kasih' } });
    const b = await sariApi(`/chat/conversations/${hrConvId}/messages`, { method: 'POST', headers: CHAT_HDR, json: { clientMsgId: cid, body: 'Terima kasih' } });
    assert((b.json() as { message: { duplicate: boolean; id: string } }).message.duplicate === true && (a.json() as { message: { id: string } }).message.id === (b.json() as { message: { id: string } }).message.id, 'pengiriman ulang menggandakan pesan');
    const own = await ownerB.fetch(`${API}/chat/conversations/${hrConvId}/messages`);
    assert(own.status === 401 || own.status === 403, `owner tanpa sesi chat bisa baca: ${own.status}`);
    const l = await login(ownerB, 'chat', { ...ownerCreds, password: ownerCreds.newPassword });
    assert(l.status === 302, 'login chat owner');
    const nm = await ownerB.fetch(`${API}/chat/conversations/${hrConvId}/messages`);
    assert(nm.status === 403, `bukan anggota: ${nm.status}`);
    return 'duplicate=true, id sama; non-anggota 403';
  });

  await scenario('S8 HR memutuskan: Sari tidak bisa setujui sendiri; Rina setuju → APPROVED; sinkron ERP DEMO SYNCED; retry tidak menggandakan', async () => {
    const self = await sariApi(`/hr/requests/${requestId}/decide`, { method: 'POST', headers: CHAT_HDR, json: { decision: 'APPROVED' } });
    assert(self.status === 403, `setujui sendiri: ${self.status}`);
    const queue = (await rinaApi('/hr/queue')).json() as Array<{ requestId: string }>;
    assert(queue.some((q) => q.requestId === requestId), 'antrean HR tidak memuat pengajuan');
    const d = await rinaApi(`/hr/requests/${requestId}/decide`, { method: 'POST', headers: CHAT_HDR, json: { decision: 'APPROVED', note: 'OK' } });
    assert(d.status < 300, `decide: ${d.text}`);
    let row = await db.selectFrom('hr.leave_requests').selectAll().where('id', '=', requestId).executeTakeFirstOrThrow();
    assert(row.status === 'APPROVED' && row.erp_sync_status === 'PENDING', `status ${row.status}/${row.erp_sync_status}`);
    await tick();
    row = await db.selectFrom('hr.leave_requests').selectAll().where('id', '=', requestId).executeTakeFirstOrThrow();
    assert(row.erp_sync_status === 'SYNCED' && row.erp_reference, `sync ${row.erp_sync_status} ${row.erp_last_error}`);
    const before = Number((await db.selectFrom('ops.erp_demo_attendance_notes').select((eb) => eb.fn.countAll().as('n')).where('employee_id', '=', 'EMP-0004').executeTakeFirstOrThrow()).n);
    await db.insertInto('ops.outbox_events').values({ aggregate: 'leave_request', aggregate_id: requestId, type: 'LEAVE_APPROVED', payload: JSON.stringify({ requestId, version: row.version }) }).execute();
    await tick();
    const after = Number((await db.selectFrom('ops.erp_demo_attendance_notes').select((eb) => eb.fn.countAll().as('n')).where('employee_id', '=', 'EMP-0004').executeTakeFirstOrThrow()).n);
    assert(before === after && before >= 1, `catatan absensi berubah ${before}→${after}`);
    const dup = await rinaApi(`/hr/requests/${requestId}/decide`, { method: 'POST', headers: CHAT_HDR, json: { decision: 'REJECTED' } });
    assert(dup.status === 409, 'keputusan kedua diterima');
    return `APPROVED oleh Rina, ERP DEMO ref ${row.erp_reference}, catatan ${after} (retry tidak menambah)`;
  });

  await scenario('S9 Penolakan tidak menulis absensi; pembatalan oleh karyawan mempertahankan histori', async () => {
    const second = await db.selectFrom('hr.leave_requests').select('id').where('employee_user_id', '=', sariId).where('status', '=', 'PENDING_APPROVAL').executeTakeFirstOrThrow();
    const d = await rinaApi(`/hr/requests/${second.id}/decide`, { method: 'POST', headers: CHAT_HDR, json: { decision: 'REJECTED', note: 'Tidak ada pengganti' } });
    assert(d.status < 300, d.text);
    await tick();
    const row = await db.selectFrom('hr.leave_requests').selectAll().where('id', '=', second.id).executeTakeFirstOrThrow();
    assert(row.status === 'REJECTED' && row.erp_sync_status === 'NOT_SENT', `${row.status}/${row.erp_sync_status}`);
    const c = await sariApi(`/hr/requests/${requestId}/cancel`, { method: 'POST', headers: CHAT_HDR });
    assert(c.status < 300, c.text);
    const hist = await db.selectFrom('hr.leave_request_history').select('action').where('request_id', '=', requestId).orderBy('id').execute();
    assert(hist.map((h) => h.action).join(',') === 'CREATED,APPROVED,CANCELLED', hist.map((h) => h.action).join(','));
    await tick();
    const after = await db.selectFrom('hr.leave_requests').select(['status', 'erp_sync_status']).where('id', '=', requestId).executeTakeFirstOrThrow();
    assert(after.status === 'CANCELLED' && after.erp_sync_status === 'SYNCED', `pembatalan: ${JSON.stringify(after)}`);
    return `histori: ${hist.map((h) => h.action).join(' → ')}; koreksi tercatat`;
  });

  await scenario('S10 WebSocket: tiket valid tersambung; cabut akses Chat memutus WS dan menolak API, akses WORK Rina tetap', async () => {
    const t = (await sariApi('/chat/ws-ticket', { method: 'POST', headers: CHAT_HDR })).json() as { ticket: string };
    const ws = new WebSocket(`ws://localhost:4000/ws?ticket=${t.ticket}`);
    const ready = await new Promise<boolean>((res) => { ws.on('message', (m) => { if (String(m).includes('ready')) res(true); }); ws.on('close', () => res(false)); setTimeout(() => res(false), 4000); });
    assert(ready, 'WS tidak ready');
    const closed = new Promise<number>((res) => ws.on('close', (code) => res(code)));
    const r = await workApi(`/work/accounts/${sariId}/grants`, { method: 'POST', headers: WORK_HDR, json: { app: 'CHAT', enable: false } });
    assert(r.status < 300, r.text);
    const code = await Promise.race([closed, new Promise<number>((res) => setTimeout(() => res(0), 4000))]);
    assert(code === 4401, `WS tidak ditutup (code ${code})`);
    const me = await sariApi('/chat/me');
    assert(me.status === 401 || (me.status === 403 && me.text.includes('NO_APP_GRANT')), `chat/me setelah cabut: ${me.status} ${me.text}`);
    const stale = new WebSocket(`ws://localhost:4000/ws?ticket=${t.ticket}`);
    const staleCode = await new Promise<number>((res) => { stale.on('close', (c) => res(c)); setTimeout(() => res(0), 4000); });
    assert(staleCode === 4401, `tiket lama diterima (${staleCode})`);
    // Rina (HR) tetap bisa masuk Work meski Sari dicabut (tidak terkait); grant WORK Rina masih ACTIVE
    const rl = await login(rinaB, 'work', { username: RINA, password: 'RinaSandi!2026' });
    assert(rl.status === 302 && rinaB.cookie('lw_sid'), 'rina tidak bisa masuk work');
    const re = await workApi(`/work/accounts/${sariId}/grants`, { method: 'POST', headers: WORK_HDR, json: { app: 'CHAT', enable: true } });
    assert(re.status < 300, re.text);
    const l = await login(sariB, 'chat', { username: SARI, password: sariTemp });
    assert(l.status === 302 && (await sariApi('/chat/me')).status === 200, 'grant ulang tidak memulihkan akses');
    return 'WS close 4401, tiket lama ditolak, grant ulang memulihkan';
  });

  await scenario('S11 Delegasi: HR tidak bisa memberi OWNER/ACCOUNT_ADMIN, tidak bisa ubah peran sendiri; owner bisa', async () => {
    const rinaWork = rinaB.api(API);
    const a = await rinaWork(`/work/accounts/${sariId}/roles`, { method: 'POST', headers: WORK_HDR, json: { role: 'OWNER', scope: null } });
    assert(a.status === 403, `HR memberi OWNER: ${a.status}`);
    const b = await rinaWork(`/work/accounts/${sariId}/roles`, { method: 'POST', headers: WORK_HDR, json: { role: 'ACCOUNT_ADMIN', scope: null } });
    assert(b.status === 403, `HR memberi ACCOUNT_ADMIN: ${b.status}`);
    const c = await rinaWork(`/work/accounts/${rinaId}/roles`, { method: 'POST', headers: WORK_HDR, json: { role: 'HR', scope: null } });
    assert(c.status === 403, `HR memperluas diri: ${c.status}`);
    const d = await rinaWork(`/work/accounts/${sariId}/grants`, { method: 'POST', headers: WORK_HDR, json: { app: 'WORK', enable: true } });
    assert(d.status === 403, `HR memberi WORK: ${d.status}`);
    const e = await rinaWork(`/work/accounts/${sariId}/roles`, { method: 'POST', headers: WORK_HDR, json: { role: 'APPROVER', scope: ['Produksi'] } });
    assert(e.status < 300, `HR memberi APPROVER: ${e.text}`);
    const f = await workApi(`/work/accounts/${rinaId}/roles`, { method: 'POST', headers: WORK_HDR, json: { role: 'ACCOUNT_ADMIN', scope: ['HR'] } });
    assert(f.status < 300, `owner memberi ACCOUNT_ADMIN: ${f.text}`);
    const g = await rinaWork(`/work/accounts/${sariId}/roles`, { method: 'POST', headers: WORK_HDR, json: { role: 'HR', scope: ['Gudang'] } });
    assert(g.status === 403, `admin terbatas HR menetapkan di luar cakupan: ${g.status}`);
    return 'OWNER/ADMIN oleh HR 403; self 403; APPROVER dalam cakupan OK; cakupan luar 403';
  });

  await scenario('S12 Undangan B dibuka saat masuk sebagai A → ketidakcocokan, akun tidak digabung', async () => {
    const r = await workApi('/work/accounts', { method: 'POST', headers: WORK_HDR, json: { employeeId: 'EMP-0005', username: DEDI, apps: ['CHAT'] } });
    assert(r.status < 300, r.text);
    const j = r.json() as { userId: string; handover: { activationUrl: string } };
    const tok = new URL(j.handover.activationUrl).searchParams.get('t')!;
    // Rina sudah punya sesi SSO; prompt=login memaksa autentikasi ulang, Rina memasukkan kredensialnya sendiri
    const a = await activate(rinaB, tok, { username: RINA, password: 'RinaSandi!2026', newPassword: 'RinaSandi!2026' });
    assert(a.status === 302 && a.location?.includes('status=mismatch'), `diharapkan mismatch: ${a.location}`);
    const dedi = await db.selectFrom('directory.users').select('status').where('id', '=', j.userId).executeTakeFirstOrThrow();
    const bind = await db.selectFrom('directory.identity_bindings').select('user_id').where('user_id', '=', j.userId).executeTakeFirst();
    assert(dedi.status === 'PENDING_ACTIVATION' && !bind, 'akun Dedi berubah');
    const rinaBind = await db.selectFrom('directory.identity_bindings').select('user_id').where('user_id', '=', rinaId).execute();
    assert(rinaBind.length === 1, 'binding Rina berubah');
    return 'status=mismatch; Dedi tetap PENDING, binding Rina utuh';
  });

  await scenario('S13 Undangan kedaluwarsa/dicabut ditolak; buat ulang undangan menghasilkan token baru', async () => {
    const dedi = await db.selectFrom('directory.users').select('id').where('username', '=', DEDI).executeTakeFirstOrThrow();
    await db.updateTable('directory.invitations').set({ expires_at: new Date(Date.now() - 1000) }).where('user_id', '=', dedi.id).execute();
    const inv = await db.selectFrom('directory.invitations').select('id').where('user_id', '=', dedi.id).orderBy('created_at', 'desc').executeTakeFirstOrThrow();
    // token mentah tidak kita punya lagi untuk inspect; uji lewat reissue → token baru, yang lama REVOKED
    const re = await workApi(`/work/accounts/${dedi.id}/invitation`, { method: 'POST', headers: WORK_HDR, json: {} });
    assert(re.status < 300, re.text);
    const j = re.json() as { handover: { activationUrl: string; temporaryPassword: string } };
    const old = await db.selectFrom('directory.invitations').select('status').where('id', '=', inv.id).executeTakeFirstOrThrow();
    assert(old.status === 'REVOKED', `undangan lama ${old.status}`);
    const tok = new URL(j.handover.activationUrl).searchParams.get('t')!;
    const rv = await workApi(`/work/accounts/${dedi.id}/invitation`, { method: 'DELETE', headers: WORK_HDR });
    assert(rv.status < 300, rv.text);
    const ins = (await sariB.fetch(`${API}/activation/inspect`, { method: 'POST', json: { token: tok } })).json() as { status: string };
    assert(ins.status === 'REVOKED', `dicabut: ${ins.status}`);
    const bg = await new Browser('x').fetch(`${API}/activation/begin`, { method: 'POST', json: { token: tok } });
    assert(bg.status === 409, `begin undangan dicabut: ${bg.status}`);
    return 'lama REVOKED saat reissue; dicabut → inspect REVOKED, begin 409';
  });

  await scenario('S14 Aktivasi bersamaan: dua proses dengan token sama, hanya satu yang memegang undangan', async () => {
    const dedi = await db.selectFrom('directory.users').select('id').where('username', '=', DEDI).executeTakeFirstOrThrow();
    const re = await workApi(`/work/accounts/${dedi.id}/invitation`, { method: 'POST', headers: WORK_HDR, json: {} });
    const tok = new URL((re.json() as { handover: { activationUrl: string } }).handover.activationUrl).searchParams.get('t')!;
    const [a, b] = await Promise.all([new Browser('a').fetch(`${API}/activation/begin`, { method: 'POST', json: { token: tok } }), new Browser('b').fetch(`${API}/activation/begin`, { method: 'POST', json: { token: tok } })]);
    const codes = [a.status, b.status].sort();
    assert(codes[0] < 300 && codes[1] === 409, `status ${codes.join(',')}`);
    const acts = await db.selectFrom('directory.activations').select('id').where('user_id', '=', dedi.id).where('status', 'in', ['STARTED', 'AWAITING_IDP']).execute();
    assert(acts.length === 1, `aktivasi hidup: ${acts.length}`);
    return `begin: ${codes.join('/')}; 1 aktivasi hidup`;
  });

  await scenario('S15 Callback dengan state/nonce salah ditolak; redirect return di luar allowlist dinormalkan', async () => {
    const b = new Browser('cb');
    await b.fetch(`${API}/auth/chat/login?return=https://evil.example/`);
    const r = await b.fetch(`${API}/auth/chat/callback?code=abc&state=salah`);
    assert(r.status === 302 && r.location?.includes('error=callback_ditolak'), `callback: ${r.status} ${r.location}`);
    const l = await b.fetch(`${API}/auth/chat/login?return=//evil.example`);
    assert(l.status === 302 && l.location?.startsWith('http://localhost:8080/'), 'login tidak ke IdP');
    return 'state salah → callback_ditolak; return eksternal → /';
  });

  await scenario('S16 Nonaktifkan akun Sari: API & WS ditolak segera, IdP dinonaktifkan oleh worker, login IdP gagal', async () => {
    await login(sariB, 'chat', { username: SARI, password: sariTemp });
    const t = (await sariApi('/chat/ws-ticket', { method: 'POST', headers: CHAT_HDR })).json() as { ticket: string };
    const ws = new WebSocket(`ws://localhost:4000/ws?ticket=${t.ticket}`);
    await new Promise<void>((res) => { ws.on('message', () => res()); setTimeout(res, 3000); });
    const closed = new Promise<number>((res) => ws.on('close', (c) => res(c)));
    const r = await workApi(`/work/accounts/${sariId}/disable`, { method: 'POST', headers: WORK_HDR, json: { reason: 'Uji offboarding' } });
    assert(r.status < 300, r.text);
    const code = await Promise.race([closed, new Promise<number>((res) => setTimeout(() => res(0), 4000))]);
    assert(code === 4401, `WS tidak ditutup: ${code}`);
    const me = await sariApi('/chat/me');
    assert(me.status === 401 || me.status === 403, `chat/me: ${me.status}`);
    await tick();
    const u = await db.selectFrom('directory.users').select('idp_user_ref').where('id', '=', sariId).executeTakeFirstOrThrow();
    const ku = await idp().getUser(u.idp_user_ref!);
    assert(ku && ku.enabled === false, 'user IdP masih enabled');
    const fresh = new Browser('sari2');
    const d = await driveKeycloak(fresh, `${API}/auth/chat/login`, { username: SARI, password: sariTemp });
    assert(!d.callbackUrl, 'login IdP masih berhasil setelah nonaktif');
    const job = await db.selectFrom('ops.provisioning_jobs').select(['status', 'result']).where('user_id', '=', sariId).where('kind', '=', 'DEACTIVATE_ACCOUNT').executeTakeFirstOrThrow();
    assert(job.status === 'DONE' && (job.result as { push: string }).push === 'BELUM_TERHUBUNG', JSON.stringify(job));
    return `WS 4401, IdP disabled, login IdP gagal, job ${job.status} push=BELUM_TERHUBUNG`;
  });

  await scenario('S17 Pemulihan: IdP timeout saat provisioning → retry melanjutkan job yang sama tanpa identitas ganda', async () => {
    const r = await workApi('/work/accounts', { method: 'POST', headers: WORK_HDR, json: { employeeId: 'EMP-0007', username: `agus.${RUN}`, apps: ['CHAT'] } });
    assert(r.status < 300, r.text);
    const j = r.json() as { userId: string };
    // Simulasikan hasil ambigu: kembalikan job ke tahap SETUP_IDENTITY seolah timeout setelah user IdP terbuat
    const job = await db.selectFrom('ops.provisioning_jobs').select('id').where('user_id', '=', j.userId).where('kind', '=', 'PROVISION_ACCOUNT').executeTakeFirstOrThrow();
    await db.updateTable('ops.provisioning_jobs').set({ status: 'PENDING', stage: 'SETUP_IDENTITY', next_run_at: new Date() }).where('id', '=', job.id).execute();
    await db.updateTable('directory.users').set({ idp_user_ref: null }).where('id', '=', j.userId).execute();
    const run = await runJobInline(job.id);
    assert(run.status === 'DONE', `retry: ${run.status} ${run.error}`);
    const u = await db.selectFrom('directory.users').select('idp_user_ref').where('id', '=', j.userId).executeTakeFirstOrThrow();
    const found = await idp().findByUsername(`agus.${RUN}`);
    assert(found && u.idp_user_ref === found.id, 'identitas IdP ganda/berbeda');
    const jobs = await db.selectFrom('ops.provisioning_jobs').select('id').where('user_id', '=', j.userId).where('kind', '=', 'PROVISION_ACCOUNT').execute();
    assert(jobs.length === 1, 'job ganda');
    const inv = await db.selectFrom('directory.invitations').select('status').where('user_id', '=', j.userId).orderBy('created_at', 'desc').execute();
    assert(inv[0].status === 'PENDING' && inv.filter((i) => i.status === 'PENDING').length === 1, `undangan: ${inv.map((i) => i.status).join(',')}`);
    return 'retry menemukan user IdP via lemone_user_id; 1 job, 1 undangan PENDING';
  });

  await scenario('S18 Admin bersamaan: dua Owner saling mencabut peran → tepat satu berhasil (LAST_ADMIN)', async () => {
    const r = await workApi('/work/accounts', { method: 'POST', headers: WORK_HDR, json: { employeeId: 'EMP-0006', username: OWNER2, apps: ['CHAT', 'WORK'], roles: [{ role: 'OWNER', scope: null }] } });
    assert(r.status < 300, r.text);
    const j = r.json() as { userId: string; handover: { activationUrl: string; temporaryPassword: string } };
    const tok = new URL(j.handover.activationUrl).searchParams.get('t')!;
    const creds2 = { username: OWNER2, password: j.handover.temporaryPassword, newPassword: 'Owner2Sandi!2026', totpSecret: owner2Totp };
    const a = await activate(owner2B, tok, creds2);
    assert(a.status === 302 && a.location?.includes('status=done'), `aktivasi owner2: ${a.location} ${a.steps.join('>')}`);
    const l = await login(owner2B, 'work', { ...creds2, password: creds2.newPassword });
    assert(l.status === 302 && owner2B.cookie('lw_sid'), 'login owner2');
    // stephanus (bootstrap) masih PENDING, jadi admin aktif = owner & owner2 saja
    const o2 = owner2B.api(API);
    const [x, y] = await Promise.all([
      workApi(`/work/accounts/${j.userId}/roles/OWNER`, { method: 'DELETE', headers: WORK_HDR }),
      o2(`/work/accounts/${ownerId}/roles/OWNER`, { method: 'DELETE', headers: WORK_HDR }),
    ]);
    const ok = [x, y].filter((s) => s.status < 300).length;
    const last = [x, y].filter((s) => s.status === 409 && s.text.includes('LAST_ADMIN')).length;
    assert(ok === 1 && last === 1, `hasil: ${x.status} ${x.text.slice(0, 80)} | ${y.status} ${y.text.slice(0, 80)}`);
    const admins = await db.selectFrom('directory.role_assignments as r').innerJoin('directory.users as u', 'u.id', 'r.user_id').select('u.username').where('r.role', 'in', ['OWNER', 'ACCOUNT_ADMIN']).where('r.revoked_at', 'is', null).where('u.status', '=', 'ACTIVE').execute();
    assert(admins.length >= 1, 'organisasi tanpa admin aktif');
    return `1 berhasil, 1 LAST_ADMIN; admin aktif tersisa: ${admins.map((a) => a.username).join(', ')}`;
  });

  await scenario('S19 Audit tidak memuat secret; log akses meredaksi token', async () => {
    const rows = await db.selectFrom('ops.audit_events').select('details').orderBy('id', 'desc').limit(500).execute();
    const blob = JSON.stringify(rows);
    assert(sariTemp.length > 5 && sariToken.length > 10, 'prasyarat S19 tidak terpenuhi');
    assert(!blob.includes(sariTemp) && !blob.includes('OwnerSandi') && !blob.includes(sariToken), 'secret bocor ke audit');
    const { redact } = await import('../../src/common/crypto');
    assert(redact('/activate?t=abc123&x=1').includes('t=[redacted]'), 'redaksi gagal');
    return `${rows.length} baris audit diperiksa, tanpa secret`;
  });

  await ctx.close();
  await getPool().end();
  const fails = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n${results.length - fails}/${results.length} PASS`);
  console.log('\n| Skenario | Status | Bukti |\n|---|---|---|');
  for (const r of results) console.log(`| ${r.name} | ${r.status} | ${r.evidence.replace(/\|/g, '/')} |`);
  process.exit(fails ? 1 : 0);
}

async function fetchKcDelete(idpUserId: string) {
  const c = (await import('../../src/config')).config();
  const tok = await fetch(`${c.KC_ADMIN_URL}/realms/${c.KC_REALM}/protocol/openid-connect/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.IDP_PROVISIONER_CLIENT_ID, client_secret: c.IDP_PROVISIONER_CLIENT_SECRET }) });
  const { access_token } = (await tok.json()) as { access_token: string };
  await fetch(`${c.KC_ADMIN_URL}/admin/realms/${c.KC_REALM}/users/${idpUserId}`, { method: 'DELETE', headers: { authorization: `Bearer ${access_token}` } });
}

main().catch((e) => { console.error(e); process.exit(1); });
