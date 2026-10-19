import type { Kysely } from 'kysely';
import { getDb } from '../db/db';
import type { DB } from '../db/types';

export interface AuditInput {
  actorUserId?: string | null;
  actorKind?: 'USER' | 'SYSTEM' | 'WORKER';
  action: string;
  targetType?: string;
  targetId?: string;
  correlationId?: string | null;
  outcome?: 'OK' | 'DENIED' | 'FAILED';
  details?: Record<string, unknown>;
}

const SECRET_KEYS = /token|secret|password|code|authorization|cookie/i;
function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = SECRET_KEYS.test(k) ? '[redacted]' : scrub(val);
    return o;
  }
  return v;
}

/** Catat tindakan penting. Tidak pernah menyimpan secret; kunci yang mencurigakan diredaksi. */
export async function audit(input: AuditInput, db: Kysely<DB> = getDb()): Promise<void> {
  await db
    .insertInto('ops.audit_events')
    .values({
      actor_user_id: input.actorUserId ?? null,
      actor_kind: input.actorKind ?? (input.actorUserId ? 'USER' : 'SYSTEM'),
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      correlation_id: input.correlationId ?? null,
      outcome: input.outcome ?? 'OK',
      details: JSON.stringify(scrub(input.details ?? {})),
    })
    .execute();
}
