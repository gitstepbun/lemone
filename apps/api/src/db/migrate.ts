import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPool } from './db';

export async function migrate(): Promise<string[]> {
  const pool = getPool();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS ops.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query('SELECT pg_advisory_lock(729102)');
    const done = new Set((await client.query('SELECT name FROM ops.schema_migrations')).rows.map((r: { name: string }) => r.name));
    const dir = join(__dirname, '..', '..', 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const body = readFileSync(join(dir, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(body);
        await client.query('INSERT INTO ops.schema_migrations (name) VALUES ($1)', [f]);
        await client.query('COMMIT');
        applied.push(f);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migrasi ${f} gagal: ${(e as Error).message}`);
      }
    }
    await client.query('SELECT pg_advisory_unlock(729102)');
  } finally {
    client.release();
  }
  return applied;
}

if (process.argv[1] && /migrate\.(ts|js)$/.test(process.argv[1])) {
  migrate()
    .then((a) => {
      console.log(a.length ? `Migrasi diterapkan: ${a.join(', ')}` : 'Tidak ada migrasi baru');
      return getPool().end();
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
