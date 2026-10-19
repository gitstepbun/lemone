import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
// DATE (oid 1082) dikembalikan sebagai string YYYY-MM-DD, bukan Date dengan zona waktu.
types.setTypeParser(1082, (v) => v);
// BIGINT (oid 20) sebagai number: nomor urut pesan/versi jauh di bawah 2^53.
types.setTypeParser(20, (v) => Number(v));
import { config } from '../config';
import type { DB } from './types';

let pool: Pool | null = null;
let db: Kysely<DB> | null = null;

export function getPool(): Pool {
  if (!pool) pool = new Pool({ connectionString: config().DATABASE_URL, max: 10 });
  return pool;
}

export function getDb(): Kysely<DB> {
  if (!db) db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: getPool() }) });
  return db;
}

export async function closeDb() {
  await db?.destroy();
  db = null;
  pool = null;
}

export { sql };
