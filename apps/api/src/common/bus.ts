import { EventEmitter } from 'node:events';
import type { Client } from 'pg';
import { getPool, sql, getDb } from '../db/db';

/**
 * Bus lintas proses lewat Postgres LISTEN/NOTIFY (API dan worker adalah proses berbeda).
 * Pengirim hanya memanggil pg_notify; proses yang memegang WebSocket (API) mendengarkan dan meneruskan ke klien.
 */
const CHANNEL = 'lemone_events';
export const bus = new EventEmitter();
bus.setMaxListeners(50);

export interface RevokeEvent { kind: 'revoke'; userId: string; app?: 'CHAT' | 'WORK'; reason: string }
export interface ChatEvent { kind: 'chat'; conversationId: string; recipientUserIds: string[]; event: string; messageId?: string; data?: unknown }
type BusEvent = RevokeEvent | ChatEvent;

async function notify(e: BusEvent) {
  const payload = JSON.stringify(e);
  await sql`select pg_notify(${CHANNEL}, ${payload})`.execute(getDb());
}

export async function emitRevoke(e: Omit<RevokeEvent, 'kind'>) {
  await notify({ kind: 'revoke', ...e });
}
export async function emitChat(e: Omit<ChatEvent, 'kind'>) {
  await notify({ kind: 'chat', ...e });
}
export function onRevoke(fn: (e: RevokeEvent) => void) { bus.on('revoke', fn); }
export function onChat(fn: (e: ChatEvent) => void) { bus.on('chat', fn); }

let listener: Client | null = null;
/** Dipanggil sekali oleh proses API: mendengarkan channel dan memancarkan ke bus lokal. Menyambung ulang bila putus. */
export async function startBusListener(): Promise<void> {
  if (listener) return;
  const connect = async () => {
    const c = await getPool().connect();
    const raw = c as unknown as Client;
    listener = raw;
    raw.on('notification', (n) => {
      if (n.channel !== CHANNEL || !n.payload) return;
      try {
        const e = JSON.parse(n.payload) as BusEvent;
        bus.emit(e.kind, e);
      } catch { /* abaikan payload rusak */ }
    });
    raw.on('error', () => { listener = null; setTimeout(connect, 2000); });
    await raw.query(`LISTEN ${CHANNEL}`);
  };
  await connect();
}
