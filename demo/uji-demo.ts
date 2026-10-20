const pw = require(process.env.PW_MODULE ?? 'playwright');
const URL = 'file://' + require('node:path').resolve(__dirname, 'lemone-chat-demo.html');
const B = require('node:path').resolve(__dirname, '../docs/bukti') + '/';
(async () => {
  const b = await pw.chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 420, height: 860 }, offline: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e: any) => console.log('PAGEERROR', e.message));
  p.on('console', (m: any) => m.type() === 'error' && console.log('CONSOLE', m.text()));
  const res: string[] = [];
  const step = async (n: string, f: () => Promise<void>) => { try { await f(); res.push('PASS ' + n); console.log('PASS', n); } catch (e) { res.push('FAIL ' + n); console.log('FAIL', n, String(e).slice(0, 200)); await p.screenshot({ path: B + 'demo-fail.png' }); } };
  const vis = (t: string | RegExp) => p.getByText(t).locator('visible=true').first();
  await step('daftar Andi (admin) lewat form', async () => {
    await p.goto(URL); await p.screenshot({ path: B + '30-demo-masuk.png' });
    await p.getByRole('button', { name: 'Daftar' }).click();
    await p.fill('input[name=nama]', 'Andi Wijaya'); await p.fill('input[name=username]', 'andi'); await p.fill('input[name=sandi]', 'demo1234');
    await p.click('button[type=submit]');
    await vis('@hr').waitFor();
    await p.screenshot({ path: B + '31-demo-chat.png' });
  });
  await step('daftar Citra setelah keluar', async () => {
    await p.click('[data-layar=saya]'); await p.click('#keluar');
    await p.getByRole('button', { name: 'Daftar' }).click();
    await p.fill('input[name=nama]', 'Citra Dewi'); await p.fill('input[name=username]', 'citra'); await p.fill('input[name=sandi]', 'demo1234');
    await p.click('button[type=submit]'); await vis('@hr').waitFor();
  });
  await step('Citra: izin tanpa tanggal → ditanya → jawab Besok → kartu Menunggu', async () => {
    await vis('@hr').click();
    await p.fill('#tulis', 'Saya izin tidak masuk karena urusan keluarga'); await p.press('#tulis', 'Enter');
    await vis('tanggal berapa?').waitFor();
    await p.click('[data-cepat=Besok]');
    await vis('Menunggu persetujuan').waitFor();
    await p.screenshot({ path: B + '32-demo-kartu.png' });
  });
  await step('Citra: "izin tanya" tidak jadi pengajuan', async () => {
    await p.fill('#tulis', 'izin tanya, cuti tahunan sisa berapa?'); await p.press('#tulis', 'Enter');
    await vis('petugas HR akan membalas').waitFor();
    const n = await p.locator('.kartu[data-req]').count(); if (n !== 1) throw new Error('kartu=' + n);
  });
  await step('Citra: DM ke Andi', async () => {
    await p.click('#kembali'); await p.fill('#cari', 'andi'); await p.click('[data-dm]');
    await p.fill('#tulis', 'Halo Andi'); await p.press('#tulis', 'Enter'); await vis('Halo Andi').waitFor();
  });
  await step('Ganti pengguna → Andi lihat HR badge, setujui → absensi DEMO tersinkron', async () => {
    await p.click('#kembali'); await p.click('[data-layar=saya]'); await p.click('#gantiUser'); await p.locator('.modal [data-u]', { hasText: 'Andi' }).click();
    await vis('Halo Andi').waitFor();
    await p.click('[data-layar=hr]'); await vis('Citra Dewi').waitFor();
    await p.click('[data-setuju]'); await p.fill('#cat', 'OK'); await p.click('#ok');
    await p.click('[data-tabhr=DISETUJUI]'); await vis('DEMO-ATT-1').waitFor({ timeout: 5000 });
    await p.screenshot({ path: B + '33-demo-hr.png' });
  });
  await step('Citra lihat kartu Disetujui + absensi di Saya', async () => {
    await p.click('[data-layar=saya]'); await p.click('#gantiUser'); await p.locator('.modal [data-u]', { hasText: 'Citra' }).click();
    await vis('@hr').click(); await vis('Disetujui').waitFor(); await vis('Tercatat di absensi').waitFor();
    await p.screenshot({ path: B + '34-demo-disetujui.png' });
    await p.click('#kembali'); await p.click('[data-layar=saya]'); await vis('Pengajuan saya').waitFor();
    const izin = await p.locator('.hari .izin').count(); if (izin !== 1) throw new Error('hari izin=' + izin);
    await p.screenshot({ path: B + '35-demo-saya.png' });
  });
  await step('Batalkan yang disetujui → koreksi', async () => {
    await p.click('[data-layar=chat]'); await vis('@hr').click(); await p.click('[data-batal]'); await p.click('.modal #ok');
    await vis('Dibatalkan').waitFor(); await vis('Koreksi dikirim').waitFor();
  });
  await step('AI: jawaban DEMO menyebut sumber', async () => {
    await p.click('#kembali'); await p.click('[data-layar=ai]'); await p.click('[data-ai="status pengajuan saya"]');
    await vis('Sumber: SOP DEMO').waitFor({ timeout: 5000 });
    await p.screenshot({ path: B + '36-demo-ai.png' });
  });
  await step('Refresh: data tetap (localStorage)', async () => {
    await p.reload(); await vis('AI').waitFor(); await p.click('[data-layar=chat]'); await vis('@hr').waitFor();
  });
  await step('Sandi salah ditolak', async () => {
    await p.click('[data-layar=saya]'); await p.click('#keluar');
    await p.fill('input[name=username]', 'citra'); await p.fill('input[name=sandi]', 'salahsalah'); await p.click('button[type=submit]');
    await vis('Username atau sandi salah').waitFor();
  });
  await step('Desktop 2 panel', async () => {
    const d = p; await d.setViewportSize({ width: 1200, height: 800 });
    await d.goto(URL); await d.fill('input[name=username]', 'andi'); await d.fill('input[name=sandi]', 'demo1234'); await d.click('button[type=submit]');
    await d.locator('.baris', { hasText: 'Halo Andi' }).first().click(); await d.locator('.pesan-area').getByText('Halo Andi').waitFor();
    await d.screenshot({ path: B + '37-demo-desktop.png' });
  });
  await b.close();
  console.log(res.filter((r) => r.startsWith('PASS')).length + '/' + res.length + ' PASS');
})();
