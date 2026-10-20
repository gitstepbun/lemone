const pw = require(process.env.PW_MODULE ?? 'playwright');
const RUN = Date.now().toString(36).slice(-4);
const BASE = process.env.BASE ?? 'http://localhost:3002';
(async () => {
  if (process.env.RESET_DB === '1') { require('node:child_process').execSync(process.env.RESET_DB_CMD ?? 'docker exec lemone-postgres-1 psql -U lemone -d lemone -c "TRUNCATE directory.users CASCADE"'); require('node:child_process').execSync('node dist/db/seed.js', { env: process.env, stdio: 'ignore' }); }
  const b = await pw.chromium.launch();
  const mk = async () => (await b.newContext({ viewport: { width: 420, height: 860 }, locale: 'id-ID' })).newPage();
  const a = await mk(); const c = await mk();
  const res: string[] = [];
  const step = async (n: string, f: () => Promise<void>) => { try { await f(); res.push('PASS ' + n); console.log('PASS', n); } catch (e) { res.push('FAIL ' + n); console.log('FAIL', n, String(e).slice(0, 180)); await a.screenshot({ path: '../../docs/bukti/local-fail-a.png' }); await c.screenshot({ path: '../../docs/bukti/local-fail-c.png' }); } };
  const register = async (p: any, name: string, user: string) => {
    await p.goto(`${BASE}/masuk`);
    await p.getByRole('button', { name: 'Daftar' }).click();
    await p.fill('input[autocomplete=name]', name);
    await p.fill('input[autocomplete=username]', user);
    await p.fill('input[type=password]', 'Sandi!' + RUN + 'x');
    await p.locator('button[type=submit]').click();
    await p.waitForURL(/localhost:3002\/(\?.*)?$/, { timeout: 20000 });
  };
  await step('daftar Andi dan Citra lewat form', async () => {
    await register(a, 'Andi Wijaya', 'andi.' + RUN);
    await register(c, 'Citra Dewi', 'citra.' + RUN);
    await a.getByText('@hr', { exact: true }).first().waitFor({ timeout: 20000 });
    await a.screenshot({ path: '../../docs/bukti/19-local-daftar.png', fullPage: true });
  });
  await step('salah sandi ditolak', async () => {
    const p = await mk();
    await p.goto(`${BASE}/masuk`); await p.fill('input[autocomplete=username]', 'andi.' + RUN); await p.fill('input[type=password]', 'salah-salah'); await p.locator('button[type=submit]').click();
    await p.getByText('Username atau sandi salah').waitFor({ timeout: 10000 });
    await p.close();
  });
  await step('Andi cari Citra → DM → pesan tiba realtime di Citra', async () => {
    await a.goto(`${BASE}/`);
    await a.getByPlaceholder(/Cari/).fill('citra.' + RUN);
    await a.locator('button', { hasText: '@citra.' + RUN }).locator('visible=true').first().click();
    await a.waitForURL(/\/c\//, { timeout: 20000 });
    const box = a.locator('textarea, input[type=text]').last();
    await box.fill('Halo Citra, ini dari Andi'); await box.press('Enter');
    await c.goto(`${BASE}/`);
    await c.getByText('Halo Citra, ini dari Andi').locator('visible=true').first().waitFor({ timeout: 20000 });
    await c.getByText('Andi Wijaya').locator('visible=true').first().click();
    await c.waitForURL(/\/c\//, { timeout: 20000 });
    const cbox = c.locator('textarea, input[type=text]').last();
    await cbox.fill('Halo Andi, diterima'); await cbox.press('Enter');
    await a.getByText('Halo Andi, diterima').locator('visible=true').first().waitFor({ timeout: 20000 });
    await a.screenshot({ path: '../../docs/bukti/20-local-dm.png', fullPage: true });
  });
  await step('Citra kirim izin ke @hr → kartu Menunggu persetujuan', async () => {
    await c.goto(`${BASE}/`);
    await c.getByText('@hr', { exact: true }).first().click();
    await c.waitForURL(/\/c\//, { timeout: 20000 });
    const cbox = c.locator('textarea, input[type=text]').last();
    await cbox.fill('Saya izin tidak masuk besok karena urusan keluarga'); await cbox.press('Enter');
    await c.getByText('Menunggu persetujuan').waitFor({ timeout: 20000 });
  });
  await step('Andi (admin pertama) setujui di tab HR → kartu Citra jadi Disetujui', async () => {
    await a.goto(`${BASE}/hr`);
    await a.getByText('Citra Dewi').locator('visible=true').first().waitFor({ timeout: 20000 });
    a.once('dialog', (d: any) => d.accept('OK'));
    await a.getByRole('button', { name: 'Setujui', exact: true }).first().click();
    await a.getByText('Menunggu persetujuan').locator('visible=true').first().waitFor({ state: 'hidden', timeout: 20000 });
    await a.screenshot({ path: '../../docs/bukti/21-local-hr-setujui.png', fullPage: true });
    await c.getByText(/Disetujui/).locator('visible=true').first().waitFor({ timeout: 30000 });
    await c.screenshot({ path: '../../docs/bukti/22-local-kartu-disetujui.png', fullPage: true });
  });
  await step('Saya: ganti sandi lalu masuk dengan sandi baru', async () => {
    await a.goto(`${BASE}/saya`);
    await a.fill('input[name=current]', 'Sandi!' + RUN + 'x'); await a.fill('input[name=next]', 'SandiBaru!' + RUN);
    await a.getByRole('button', { name: 'Simpan sandi' }).click();
    await a.waitForURL(/\/masuk/, { timeout: 20000 });
    await a.fill('input[autocomplete=username]', 'andi.' + RUN); await a.fill('input[type=password]', 'SandiBaru!' + RUN); await a.locator('button[type=submit]').click();
    await a.waitForURL(/localhost:3002\/(\?.*)?$/, { timeout: 20000 });
  });
  await b.close();
  console.log(res.filter((r) => r.startsWith('PASS')).length + '/' + res.length + ' PASS');
})();
