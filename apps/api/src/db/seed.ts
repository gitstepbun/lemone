import { config } from '../config';
import { DemoErpAdapter } from '../erp/demo-erp.adapter';
import { getDb, getPool } from './db';
import { migrate } from './migrate';

/** Seed idempoten: akun layanan (@hr, @hr.ai, @lemone.ai) dan data ERP DEMO. Tanpa akun manusia, tanpa password. */
export async function seed() {
  await migrate();
  const db = getDb();
  const services: Array<{ username: string; display: string; kind: 'HR_INBOX' | 'AI_HR' | 'AI_COMPANY' }> = [
    { username: config().HR_INBOX_USERNAME, display: 'HR Lemone', kind: 'HR_INBOX' },
    { username: 'hr.ai', display: 'Asisten HR', kind: 'AI_HR' },
    { username: 'lemone.ai', display: 'Asisten Lemone', kind: 'AI_COMPANY' },
  ];
  for (const s of services) {
    const existing = await db.selectFrom('directory.service_aliases').select('user_id').where('kind', '=', s.kind).executeTakeFirst();
    if (existing) continue;
    const u = await db.insertInto('directory.users').values({ org_id: 'lemone', employee_id: null, username: s.username, display_name: s.display, kind: 'SERVICE', status: 'ACTIVE' }).returning('id').executeTakeFirstOrThrow();
    await db.insertInto('directory.service_aliases').values({ username: s.username, user_id: u.id, kind: s.kind }).execute();
  }
  let demo = 0;
  if (config().ERP_ADAPTER === 'demo') demo = await DemoErpAdapter.seed();
  return { services: services.length, demoEmployees: demo };
}

if (process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1])) {
  seed()
    .then((r) => { console.log(`Seed selesai: ${r.services} akun layanan, ${r.demoEmployees} karyawan DEMO`); return getPool().end(); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
