import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { audit } from '../common/audit';
import { config } from '../config';
import { getDb } from '../db/db';
import type { JobStatus } from '../db/types';
import { IdpError } from '../idp/keycloak-admin';

export interface JobRow {
  id: string;
  kind: string;
  user_id: string | null;
  idempotency_key: string;
  stage: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  correlation_id: string | null;
}

/** Konteks sementara per eksekusi: tempat secret sekali-tampil (tidak pernah ditulis ke DB). */
export interface JobContext {
  job: JobRow;
  ephemeral: Record<string, unknown>;
  setStage(stage: string, result?: Record<string, unknown>): Promise<void>;
}

export type StageHandler = (ctx: JobContext) => Promise<string | 'DONE' | 'NEEDS_REVIEW'>;
export interface JobDefinition {
  initial: string;
  stages: Record<string, StageHandler>;
}

const definitions = new Map<string, JobDefinition>();
export function defineJob(kind: string, def: JobDefinition) {
  definitions.set(kind, def);
}

export class RetryableError extends Error {}
export class NeedsReviewError extends Error {}

export async function enqueueJob(input: { kind: string; userId?: string | null; idempotencyKey: string; payload?: Record<string, unknown>; correlationId?: string }): Promise<string> {
  const def = definitions.get(input.kind);
  if (!def) throw new Error(`Job ${input.kind} tidak terdaftar`);
  const r = await getDb()
    .insertInto('ops.provisioning_jobs')
    .values({
      kind: input.kind,
      user_id: input.userId ?? null,
      idempotency_key: input.idempotencyKey,
      stage: def.initial,
      status: 'PENDING',
      payload: JSON.stringify(input.payload ?? {}),
      correlation_id: input.correlationId ?? randomUUID(),
    })
    .onConflict((oc) => oc.column('idempotency_key').doNothing())
    .returning('id')
    .executeTakeFirst();
  if (r) return r.id;
  const existing = await getDb().selectFrom('ops.provisioning_jobs').select('id').where('idempotency_key', '=', input.idempotencyKey).executeTakeFirstOrThrow();
  return existing.id;
}

/** Ambil dan kunci satu job yang jatuh tempo (SKIP LOCKED agar banyak worker aman). */
export async function claimJob(workerId: string, jobId?: string): Promise<JobRow | null> {
  const db = getDb();
  return db.transaction().execute(async (trx) => {
    let q = trx
      .selectFrom('ops.provisioning_jobs')
      .selectAll()
      .where('status', 'in', jobId ? ['PENDING', 'RUNNING', 'NEEDS_REVIEW', 'FAILED'] : ['PENDING', 'RUNNING'])
      .where((eb) => eb.or([eb('locked_at', 'is', null), eb('locked_at', '<', new Date(Date.now() - (jobId ? 30_000 : 5 * 60_000)))]))
      .orderBy('next_run_at')
      .limit(1)
      .forUpdate()
      .skipLocked();
    // Eksekusi inline (permintaan admin) tidak menunggu next_run_at dan boleh mengambil alih job yang kuncinya basi.
    if (jobId) q = q.where('id', '=', jobId);
    else q = q.where('next_run_at', '<=', new Date());
    const row = await q.executeTakeFirst();
    if (!row) return null;
    await trx
      .updateTable('ops.provisioning_jobs')
      .set({ status: 'RUNNING', locked_at: new Date(), locked_by: workerId, attempts: row.attempts + 1, updated_at: new Date() })
      .where('id', '=', row.id)
      .execute();
    return { ...row, attempts: row.attempts + 1 } as JobRow;
  });
}

/** Jalankan satu job sampai selesai, gagal sementara, atau perlu tinjauan. Mengembalikan konteks (berisi ephemeral). */
export async function runJob(row: JobRow): Promise<{ status: JobStatus; stage: string; ephemeral: Record<string, unknown>; error?: string }> {
  const def = definitions.get(row.kind);
  const db = getDb();
  if (!def) {
    await db.updateTable('ops.provisioning_jobs').set({ status: 'NEEDS_REVIEW', last_error: 'Job tidak terdaftar', locked_at: null }).where('id', '=', row.id).execute();
    return { status: 'NEEDS_REVIEW', stage: row.stage, ephemeral: {}, error: 'Job tidak terdaftar' };
  }
  const ctx: JobContext = {
    job: row,
    ephemeral: {},
    async setStage(stage, result) {
      ctx.job.stage = stage;
      if (result) ctx.job.result = { ...ctx.job.result, ...result };
      await db
        .updateTable('ops.provisioning_jobs')
        .set({ stage, result: JSON.stringify(ctx.job.result), updated_at: new Date() })
        .where('id', '=', row.id)
        .execute();
    },
  };
  let stage = row.stage;
  try {
    for (let guard = 0; guard < 20; guard++) {
      const handler = def.stages[stage];
      if (!handler) throw new NeedsReviewError(`Tahap ${stage} tidak dikenal`);
      const next = await handler(ctx);
      if (next === 'DONE') {
        await db.updateTable('ops.provisioning_jobs').set({ status: 'DONE', stage: 'DONE', locked_at: null, last_error: null, result: JSON.stringify(ctx.job.result), updated_at: new Date() }).where('id', '=', row.id).execute();
        await audit({ actorKind: 'WORKER', action: `job.${row.kind}.done`, targetType: 'user', targetId: row.user_id ?? undefined, correlationId: row.correlation_id, details: { jobId: row.id } });
        return { status: 'DONE', stage: 'DONE', ephemeral: ctx.ephemeral };
      }
      if (next === 'NEEDS_REVIEW') throw new NeedsReviewError(`Tahap ${stage} memerlukan tinjauan`);
      stage = next;
      await ctx.setStage(stage);
    }
    throw new NeedsReviewError('Terlalu banyak tahap');
  } catch (e) {
    const err = e as Error;
    const retryable = e instanceof RetryableError || (e instanceof IdpError && e.retryable);
    const exhausted = row.attempts >= row.max_attempts;
    const status: JobStatus = e instanceof NeedsReviewError || exhausted ? 'NEEDS_REVIEW' : retryable ? 'PENDING' : 'NEEDS_REVIEW';
    const backoff = Math.min(60 * 15, 5 * 2 ** Math.min(row.attempts, 8));
    await db
      .updateTable('ops.provisioning_jobs')
      .set({ status, stage, locked_at: null, last_error: err.message.slice(0, 500), next_run_at: sql`now() + make_interval(secs => ${backoff})`, updated_at: new Date() })
      .where('id', '=', row.id)
      .execute();
    await audit({ actorKind: 'WORKER', action: `job.${row.kind}.${status === 'PENDING' ? 'retry' : 'needs_review'}`, targetType: 'user', targetId: row.user_id ?? undefined, correlationId: row.correlation_id, outcome: 'FAILED', details: { jobId: row.id, stage, error: err.message.slice(0, 300) } });
    return { status, stage, ephemeral: ctx.ephemeral, error: err.message };
  }
}

/** Jalankan job tertentu secara inline (dipakai request admin agar hasil sekali-tampil bisa diberikan). */
export async function runJobInline(jobId: string): Promise<ReturnType<typeof runJob>> {
  for (let i = 0; i < 20; i++) {
    const row = await claimJob(`inline-${config().WORKER_ID}`, jobId);
    if (row) return runJob(row);
    const cur = await getDb().selectFrom('ops.provisioning_jobs').select(['status', 'stage', 'locked_at']).where('id', '=', jobId).executeTakeFirstOrThrow();
    if (cur.status === 'DONE') return { status: 'DONE', stage: 'DONE', ephemeral: {}, error: 'Job sudah diselesaikan proses lain; hasil sekali-tampil tidak tersedia di sini' };
    await new Promise((r) => setTimeout(r, 1000));
  }
  const cur = await getDb().selectFrom('ops.provisioning_jobs').select(['status', 'stage']).where('id', '=', jobId).executeTakeFirstOrThrow();
  return { status: cur.status, stage: cur.stage, ephemeral: {}, error: 'Job sedang dikunci proses lain' };
}

/** Loop worker: proses job & outbox. */
export async function workerTick(workerId: string, outboxHandler: (e: { id: number; type: string; aggregate: string; aggregate_id: string; payload: Record<string, unknown>; correlation_id: string | null; attempts: number }) => Promise<void>): Promise<number> {
  let n = 0;
  for (let i = 0; i < 10; i++) {
    const row = await claimJob(workerId);
    if (!row) break;
    await runJob(row);
    n++;
  }
  const db = getDb();
  const events = await db.transaction().execute(async (trx) => {
    const rows = await trx
      .selectFrom('ops.outbox_events')
      .selectAll()
      .where('processed_at', 'is', null)
      .where('next_run_at', '<=', new Date())
      .orderBy('id')
      .limit(20)
      .forUpdate()
      .skipLocked()
      .execute();
    if (rows.length) await trx.updateTable('ops.outbox_events').set({ next_run_at: sql`now() + interval '2 minutes'` }).where('id', 'in', rows.map((r) => r.id)).execute();
    return rows;
  });
  for (const ev of events) {
    try {
      await outboxHandler({ id: ev.id, type: ev.type, aggregate: ev.aggregate, aggregate_id: ev.aggregate_id, payload: ev.payload as Record<string, unknown>, correlation_id: ev.correlation_id, attempts: ev.attempts });
      await db.updateTable('ops.outbox_events').set({ processed_at: new Date(), last_error: null }).where('id', '=', ev.id).execute();
    } catch (e) {
      const backoff = Math.min(900, 10 * 2 ** Math.min(ev.attempts, 7));
      await db
        .updateTable('ops.outbox_events')
        .set({ attempts: ev.attempts + 1, last_error: (e as Error).message.slice(0, 500), next_run_at: sql`now() + make_interval(secs => ${backoff})` })
        .where('id', '=', ev.id)
        .execute();
    }
    n++;
  }
  return n;
}

export async function emitOutbox(input: { aggregate: string; aggregateId: string; type: string; payload: Record<string, unknown>; correlationId?: string | null }, trx = getDb()) {
  await trx
    .insertInto('ops.outbox_events')
    .values({ aggregate: input.aggregate, aggregate_id: input.aggregateId, type: input.type, payload: JSON.stringify(input.payload), correlation_id: input.correlationId ?? null })
    .execute();
}
