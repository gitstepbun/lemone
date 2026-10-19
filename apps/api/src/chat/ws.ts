import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { onChat, onRevoke } from '../common/bus';
import { decryptJson, encryptJson } from '../common/crypto';
import { getDb } from '../db/db';

interface Ticket { u: string; v: number; e: number }

const sockets = new Map<string, Set<WebSocket>>();

export function issueWsTicket(userId: string, authzVersion: number): string {
  return encryptJson({ u: userId, v: authzVersion, e: Date.now() + 60_000 } satisfies Ticket).toString('base64url');
}

export function closeUserSockets(userId: string, code = 4401, reason = 'revoked') {
  for (const ws of sockets.get(userId) ?? []) {
    try { ws.close(code, reason); } catch { /* ignore */ }
  }
  sockets.delete(userId);
}

export function connectedUserIds(): string[] {
  return [...sockets.keys()];
}

/** Verifikasi ulang status, grant, dan versi otorisasi; tutup bila tidak lagi berhak. */
async function stillAuthorized(userId: string, authzVersion: number): Promise<boolean> {
  const u = await getDb().selectFrom('directory.users').select(['status', 'authz_version']).where('id', '=', userId).executeTakeFirst();
  if (!u || u.status !== 'ACTIVE' || u.authz_version !== authzVersion) return false;
  const g = await getDb().selectFrom('directory.application_grants').select('id').where('user_id', '=', userId).where('app', '=', 'CHAT').where('status', '=', 'ACTIVE').executeTakeFirst();
  return Boolean(g);
}

export function attachWebSocket(server: HttpServer, loadMessage: (id: string) => Promise<unknown>) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://x');
    let t: Ticket | null = null;
    try { t = decryptJson<Ticket>(Buffer.from(url.searchParams.get('ticket') ?? '', 'base64url')); } catch { t = null; }
    if (!t || t.e < Date.now() || !(await stillAuthorized(t.u, t.v))) { ws.close(4401, 'unauthorized'); return; }
    const userId = t.u;
    const ver = t.v;
    if (!sockets.has(userId)) sockets.set(userId, new Set());
    sockets.get(userId)!.add(ws);
    ws.send(JSON.stringify({ event: 'ready', data: { userId } }));
    const check = setInterval(async () => {
      if (!(await stillAuthorized(userId, ver))) ws.close(4401, 'revoked');
    }, 30_000);
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(String(raw)) as { type?: string };
        if (m.type === 'ping') ws.send(JSON.stringify({ event: 'pong', data: Date.now() }));
      } catch { /* ignore */ }
    });
    ws.on('close', () => {
      clearInterval(check);
      sockets.get(userId)?.delete(ws);
      if (sockets.get(userId)?.size === 0) sockets.delete(userId);
    });
  });
  onChat(async (e) => {
    const targets = e.recipientUserIds.filter((uid) => sockets.has(uid));
    if (!targets.length) return;
    const data = e.messageId ? await loadMessage(e.messageId).catch(() => null) : e.data;
    if (e.messageId && !data) return;
    const msg = JSON.stringify({ event: e.event, data, conversationId: e.conversationId });
    for (const uid of targets) for (const ws of sockets.get(uid) ?? []) if (ws.readyState === ws.OPEN) ws.send(msg);
  });
  onRevoke((e) => {
    if (!e.app || e.app === 'CHAT') closeUserSockets(e.userId);
  });
  return wss;
}
