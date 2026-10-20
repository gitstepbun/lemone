import { Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { audit } from '../common/audit';
import { emitChat } from '../common/bus';
import { E } from '../common/errors';
import { config } from '../config';
import { getDb } from '../db/db';
import type { DB, MessageKind } from '../db/types';
import type { Principal } from '../auth/principal';

export interface SendInput {
  clientMsgId?: string;
  kind?: MessageKind;
  body?: string;
  payload?: Record<string, unknown>;
  replyToId?: string | null;
  forwarded?: boolean;
  /** Petugas HR membalas sebagai inbox layanan. */
  asService?: boolean;
}

@Injectable()
export class ChatService {
  async serviceUser(kind: 'HR_INBOX' | 'AI_COMPANY' | 'AI_HR') {
    const r = await getDb().selectFrom('directory.service_aliases').select(['user_id', 'username']).where('kind', '=', kind).executeTakeFirst();
    if (!r) throw new Error(`Service user ${kind} belum di-seed`);
    return r;
  }

  /** Pastikan percakapan layanan (@hr, @lemone.ai, @hr.ai) ada untuk pengguna. Idempoten. */
  async ensureServiceConversations(userId: string) {
    const db = getDb();
    const u = await db
      .selectFrom('directory.users as u')
      .leftJoin('directory.employee_directory as e', (j) => j.onRef('e.employee_id', '=', 'u.employee_id').on('e.org_id', '=', 'lemone'))
      .select(['u.id', 'u.kind', 'e.division'])
      .where('u.id', '=', userId)
      .executeTakeFirst();
    if (!u || u.kind !== 'HUMAN') return;
    for (const kind of ['HR_INBOX', 'AI_COMPANY', 'AI_HR'] as const) {
      const svc = await this.serviceUser(kind);
      const type = kind === 'HR_INBOX' ? 'HR_INBOX' : 'AI';
      const dmKey = `${kind.toLowerCase()}:${userId}`;
      const conv = await db
        .insertInto('chat.conversations')
        .values({ type, dm_key: dmKey, service_user_id: svc.user_id, created_by: null, title: null })
        .onConflict((oc) => oc.column('dm_key').doNothing())
        .returning('id')
        .executeTakeFirst();
      const convId = conv?.id ?? (await db.selectFrom('chat.conversations').select('id').where('dm_key', '=', dmKey).executeTakeFirstOrThrow()).id;
      await db.insertInto('chat.participants').values({ conversation_id: convId, user_id: userId, role: 'MEMBER' }).onConflict((oc) => oc.columns(['conversation_id', 'user_id']).doNothing()).execute();
      await db.insertInto('chat.participants').values({ conversation_id: convId, user_id: svc.user_id, role: 'OFFICER' }).onConflict((oc) => oc.columns(['conversation_id', 'user_id']).doNothing()).execute();
      if (kind === 'HR_INBOX') await this.syncHrOfficers(convId, u.division ?? '');
    }
  }

  /** Petugas HR yang melayani divisi ini menjadi OFFICER pada inbox; yang tidak lagi ditugaskan keluar. */
  async syncHrOfficers(convId: string, division: string) {
    const db = getDb();
    const officers = await db
      .selectFrom('directory.hr_assignments as h')
      .innerJoin('directory.users as u', 'u.id', 'h.hr_user_id')
      .select(['h.hr_user_id', 'h.divisions'])
      .where('h.revoked_at', 'is', null)
      .where('u.status', '=', 'ACTIVE')
      .execute();
    const wanted = new Set(officers.filter((o) => o.divisions === null || o.divisions.includes(division)).map((o) => o.hr_user_id));
    const current = await db.selectFrom('chat.participants').select(['user_id', 'role']).where('conversation_id', '=', convId).where('left_at', 'is', null).execute();
    for (const id of wanted) {
      // Pemilik inbox (MEMBER) tetap MEMBER walaupun ia petugas HR; petugas lain menjadi OFFICER.
      await db.insertInto('chat.participants').values({ conversation_id: convId, user_id: id, role: 'OFFICER' }).onConflict((oc) => oc.columns(['conversation_id', 'user_id']).doUpdateSet({ left_at: null })).execute();
    }
    for (const c of current) {
      if (c.role === 'OFFICER' && !wanted.has(c.user_id)) {
        const svc = await this.serviceUser('HR_INBOX');
        if (c.user_id !== svc.user_id) await db.updateTable('chat.participants').set({ left_at: new Date() }).where('conversation_id', '=', convId).where('user_id', '=', c.user_id).execute();
      }
    }
  }

  /** Setelah petugas HR ditugaskan/dicabut: segarkan semua inbox. */
  async resyncAllHrInboxes() {
    const rows = await getDb()
      .selectFrom('chat.conversations as c')
      .innerJoin('chat.participants as p', 'p.conversation_id', 'c.id')
      .innerJoin('directory.users as u', 'u.id', 'p.user_id')
      .leftJoin('directory.employee_directory as e', (j) => j.onRef('e.employee_id', '=', 'u.employee_id').on('e.org_id', '=', 'lemone'))
      .select(['c.id', 'e.division'])
      .where('c.type', '=', 'HR_INBOX')
      .where('p.role', '=', 'MEMBER')
      .execute();
    for (const r of rows) await this.syncHrOfficers(r.id, r.division ?? '');
  }

  async directory(me: Principal, q: string) {
    const like = `%${q.trim()}%`;
    const rows = await getDb()
      .selectFrom('directory.users as u')
      .leftJoin('directory.employee_directory as e', (j) => j.onRef('e.employee_id', '=', 'u.employee_id').on('e.org_id', '=', 'lemone'))
      .leftJoin('directory.service_aliases as s', 's.user_id', 'u.id')
      .select(['u.id', 'u.username', 'u.display_name', 'u.kind', 'e.division', 'e.position', 's.kind as service_kind'])
      .where('u.status', '=', 'ACTIVE')
      .where('u.id', '!=', me.userId)
      .where((eb) => eb.or([eb('u.kind', '=', 'SERVICE'), eb.exists(eb.selectFrom('directory.application_grants as g').select('g.id').whereRef('g.user_id', '=', 'u.id').where('g.app', '=', 'CHAT').where('g.status', '=', 'ACTIVE'))]))
      .where((eb) => (q.trim() ? eb.or([eb('u.display_name', 'ilike', like), eb('u.username', 'ilike', like), eb('e.division', 'ilike', like)]) : eb.val(true)))
      .orderBy('u.kind', 'desc')
      .orderBy('u.display_name')
      .limit(50)
      .execute();
    return rows.map((r) => ({ userId: r.id, username: r.username, displayName: r.display_name, kind: r.kind, division: r.division, position: r.position, serviceKind: r.service_kind, verified: r.kind === 'SERVICE' }));
  }

  async listConversations(me: Principal) {
    await this.ensureServiceConversations(me.userId);
    const db = getDb();
    const rows = await db
      .selectFrom('chat.participants as p')
      .innerJoin('chat.conversations as c', 'c.id', 'p.conversation_id')
      .select(['c.id', 'c.type', 'c.title', 'c.service_user_id', 'c.last_message_at', 'c.last_seq', 'p.last_read_seq', 'p.role'])
      .where('p.user_id', '=', me.userId)
      .where('p.left_at', 'is', null)
      .orderBy(sql`coalesce(c.last_message_at, c.created_at)`, 'desc')
      .execute();
    const ids = rows.map((r) => r.id);
    const parts = ids.length
      ? await db
          .selectFrom('chat.participants as p')
          .innerJoin('directory.users as u', 'u.id', 'p.user_id')
          .select(['p.conversation_id', 'u.id', 'u.username', 'u.display_name', 'u.kind', 'p.role'])
          .where('p.conversation_id', 'in', ids)
          .where('p.left_at', 'is', null)
          .execute()
      : [];
    const lasts = ids.length
      ? await db
          .selectFrom('chat.messages as m')
          .innerJoin('chat.conversations as c', (j) => j.onRef('c.id', '=', 'm.conversation_id').onRef('c.last_seq', '=', 'm.seq'))
          .select(['m.conversation_id', 'm.kind', 'm.body', 'm.sender_user_id', 'm.created_at'])
          .where('m.conversation_id', 'in', ids)
          .execute()
      : [];
    const hrUsername = config().HR_INBOX_USERNAME;
    return rows.map((c) => {
      const members = parts.filter((p) => p.conversation_id === c.id);
      const other = members.find((p) => p.id !== c.service_user_id && p.id !== me.userId && p.role !== 'OFFICER');
      const svc = members.find((p) => p.id === c.service_user_id);
      let title = c.title;
      let username: string | null = null;
      let verified = false;
      if (c.type === 'DM') { title = other?.display_name ?? '?'; username = other?.username ?? null; }
      if (c.type === 'HR_INBOX') {
        verified = true;
        if (c.role === 'OFFICER' && me.userId !== c.service_user_id) {
          const member = members.find((p) => p.role === 'MEMBER');
          title = `${member?.display_name ?? '?'} → @${hrUsername}`;
          username = member?.username ?? null;
        } else { title = `@${svc?.username ?? hrUsername}`; username = svc?.username ?? hrUsername; }
      }
      if (c.type === 'AI') { verified = true; title = `@${svc?.username}`; username = svc?.username ?? null; }
      const last = lasts.find((l) => l.conversation_id === c.id);
      return {
        id: c.id, type: c.type, title, username, verified,
        myRole: c.role,
        memberCount: members.length,
        unread: Math.max(0, Number(c.last_seq) - Number(c.last_read_seq)),
        lastMessage: last ? { kind: last.kind, body: last.kind === 'CARD' ? 'Kartu pengajuan' : last.body, senderUserId: last.sender_user_id, at: last.created_at } : null,
        lastMessageAt: c.last_message_at,
      };
    });
  }

  private async assertMember(convId: string, userId: string, trx: Transaction<DB> | ReturnType<typeof getDb> = getDb()) {
    const p = await trx.selectFrom('chat.participants').select(['role']).where('conversation_id', '=', convId).where('user_id', '=', userId).where('left_at', 'is', null).executeTakeFirst();
    if (!p) throw E.forbidden('Bukan anggota percakapan.');
    return p.role;
  }

  async conversation(me: Principal, convId: string) {
    const role = await this.assertMember(convId, me.userId);
    const c = await getDb().selectFrom('chat.conversations').selectAll().where('id', '=', convId).executeTakeFirstOrThrow();
    const members = await getDb()
      .selectFrom('chat.participants as p')
      .innerJoin('directory.users as u', 'u.id', 'p.user_id')
      .leftJoin('directory.employee_directory as e', (j) => j.onRef('e.employee_id', '=', 'u.employee_id').on('e.org_id', '=', 'lemone'))
      .select(['u.id', 'u.username', 'u.display_name', 'u.kind', 'p.role', 'e.division'])
      .where('p.conversation_id', '=', convId)
      .where('p.left_at', 'is', null)
      .execute();
    return { ...c, myRole: role, members };
  }

  async openDm(me: Principal, otherUserId: string) {
    if (otherUserId === me.userId) throw E.invalid('Tidak bisa chat dengan diri sendiri.');
    const db = getDb();
    const other = await db.selectFrom('directory.users as u').leftJoin('directory.service_aliases as s', 's.user_id', 'u.id').select(['u.id', 'u.kind', 'u.status', 's.kind as service_kind']).where('u.id', '=', otherUserId).executeTakeFirst();
    if (!other || other.status !== 'ACTIVE') throw E.notFound('Pengguna');
    if (other.kind === 'SERVICE') {
      await this.ensureServiceConversations(me.userId);
      const key = `${other.service_kind!.toLowerCase()}:${me.userId}`;
      const c = await db.selectFrom('chat.conversations').select('id').where('dm_key', '=', key).executeTakeFirstOrThrow();
      return { id: c.id };
    }
    const grant = await db.selectFrom('directory.application_grants').select('id').where('user_id', '=', otherUserId).where('app', '=', 'CHAT').where('status', '=', 'ACTIVE').executeTakeFirst();
    if (!grant) throw E.forbidden('Pengguna tidak punya akses Chat.');
    const key = `dm:${[me.userId, otherUserId].sort().join(':')}`;
    const existing = await db.selectFrom('chat.conversations').select('id').where('dm_key', '=', key).executeTakeFirst();
    if (existing) return { id: existing.id };
    return db.transaction().execute(async (trx) => {
      const c = await trx.insertInto('chat.conversations').values({ type: 'DM', dm_key: key, created_by: me.userId }).onConflict((oc) => oc.column('dm_key').doNothing()).returning('id').executeTakeFirst();
      const id = c?.id ?? (await trx.selectFrom('chat.conversations').select('id').where('dm_key', '=', key).executeTakeFirstOrThrow()).id;
      for (const uid of [me.userId, otherUserId]) await trx.insertInto('chat.participants').values({ conversation_id: id, user_id: uid, role: 'MEMBER' }).onConflict((oc) => oc.columns(['conversation_id', 'user_id']).doNothing()).execute();
      return { id };
    });
  }

  async createGroup(me: Principal, title: string, memberIds: string[]) {
    if (!title.trim()) throw E.invalid('Nama grup wajib.');
    const db = getDb();
    const ids = [...new Set([me.userId, ...memberIds])];
    const ok = await db.selectFrom('directory.users as u').innerJoin('directory.application_grants as g', 'g.user_id', 'u.id').select('u.id').where('u.id', 'in', ids).where('u.status', '=', 'ACTIVE').where('u.kind', '=', 'HUMAN').where('g.app', '=', 'CHAT').where('g.status', '=', 'ACTIVE').execute();
    if (ok.length !== ids.length) throw E.invalid('Ada anggota yang tidak punya akses Chat.');
    return db.transaction().execute(async (trx) => {
      const c = await trx.insertInto('chat.conversations').values({ type: 'GROUP', title: title.trim(), created_by: me.userId }).returning('id').executeTakeFirstOrThrow();
      for (const uid of ids) await trx.insertInto('chat.participants').values({ conversation_id: c.id, user_id: uid, role: uid === me.userId ? 'ADMIN' : 'MEMBER' }).execute();
      await this.insertMessage(trx, c.id, me.userId, { kind: 'SYSTEM', body: `${me.displayName} membuat grup` });
      return { id: c.id };
    });
  }

  async messages(me: Principal, convId: string, opt: { beforeSeq?: number; afterSeq?: number; limit: number }) {
    await this.assertMember(convId, me.userId);
    let q = getDb()
      .selectFrom('chat.messages as m')
      .innerJoin('directory.users as u', 'u.id', 'm.sender_user_id')
      .leftJoin('directory.users as v', 'v.id', 'm.via_service_user_id')
      .select(['m.id', 'm.seq', 'm.sender_user_id', 'u.username as sender_username', 'u.display_name as sender_name', 'u.kind as sender_kind', 'v.username as via_username', 'm.client_msg_id', 'm.kind', 'm.body', 'm.payload', 'm.reply_to_id', 'm.forwarded', 'm.created_at'])
      .where('m.conversation_id', '=', convId);
    if (opt.beforeSeq) q = q.where('m.seq', '<', opt.beforeSeq);
    if (opt.afterSeq) q = q.where('m.seq', '>', opt.afterSeq);
    const rows = await q.orderBy('m.seq', opt.afterSeq ? 'asc' : 'desc').limit(opt.limit).execute();
    return opt.afterSeq ? rows : rows.reverse();
  }

  /** Simpan pesan dengan nomor urut per percakapan (kunci baris percakapan). Idempoten lewat client_msg_id. */
  async insertMessage(trx: Transaction<DB>, convId: string, senderId: string, input: SendInput & { viaServiceUserId?: string | null }) {
    if (input.clientMsgId) {
      const dup = await trx.selectFrom('chat.messages').select(['id', 'seq']).where('conversation_id', '=', convId).where('sender_user_id', '=', senderId).where('client_msg_id', '=', input.clientMsgId).executeTakeFirst();
      if (dup) return { ...dup, duplicate: true };
    }
    const conv = await trx.selectFrom('chat.conversations').select('last_seq').where('id', '=', convId).forUpdate().executeTakeFirstOrThrow();
    const seq = Number(conv.last_seq) + 1;
    const m = await trx
      .insertInto('chat.messages')
      .values({
        conversation_id: convId, seq, sender_user_id: senderId, via_service_user_id: input.viaServiceUserId ?? null,
        client_msg_id: input.clientMsgId ?? null, kind: input.kind ?? 'TEXT', body: input.body ?? null,
        payload: JSON.stringify(input.payload ?? {}), reply_to_id: input.replyToId ?? null, forwarded: Boolean(input.forwarded),
      })
      .returning(['id', 'seq'])
      .executeTakeFirstOrThrow();
    await trx.updateTable('chat.conversations').set({ last_seq: seq, last_message_at: new Date() }).where('id', '=', convId).execute();
    await trx.updateTable('chat.participants').set({ last_read_seq: seq }).where('conversation_id', '=', convId).where('user_id', '=', senderId).execute();
    return { ...m, duplicate: false };
  }

  async send(me: Principal, convId: string, input: SendInput) {
    const db = getDb();
    const role = await this.assertMember(convId, me.userId);
    const conv = await db.selectFrom('chat.conversations').select(['type', 'service_user_id']).where('id', '=', convId).executeTakeFirstOrThrow();
    if ((input.body ?? '').length > 4000) throw E.invalid('Pesan terlalu panjang.');
    if (!input.body?.trim() && !input.payload) throw E.invalid('Pesan kosong.');
    const viaService = conv.type === 'HR_INBOX' && role === 'OFFICER' && input.asService !== false ? conv.service_user_id : null;
    const res = await db.transaction().execute((trx) => this.insertMessage(trx, convId, me.userId, { ...input, kind: input.kind ?? 'TEXT', viaServiceUserId: viaService }));
    const full = await this.messageById(res.id);
    if (!res.duplicate) await this.broadcast(convId, 'message', full);
    return { ...full, duplicate: res.duplicate, conversationType: conv.type, senderRole: role };
  }

  async messageById(id: string) {
    return getDb()
      .selectFrom('chat.messages as m')
      .innerJoin('directory.users as u', 'u.id', 'm.sender_user_id')
      .leftJoin('directory.users as v', 'v.id', 'm.via_service_user_id')
      .select(['m.id', 'm.conversation_id', 'm.seq', 'm.sender_user_id', 'u.username as sender_username', 'u.display_name as sender_name', 'u.kind as sender_kind', 'v.username as via_username', 'm.client_msg_id', 'm.kind', 'm.body', 'm.payload', 'm.reply_to_id', 'm.forwarded', 'm.created_at'])
      .where('m.id', '=', id)
      .executeTakeFirstOrThrow();
  }

  /** Pesan sistem/kartu dari akun layanan (misalnya @hr) ke percakapan. */
  async sendAsService(convId: string, serviceUserId: string, input: SendInput) {
    const res = await getDb().transaction().execute((trx) => this.insertMessage(trx, convId, serviceUserId, input));
    const full = await this.messageById(res.id);
    await this.broadcast(convId, 'message', full);
    return full;
  }

  async updateCard(messageId: string, payload: Record<string, unknown>) {
    await getDb().updateTable('chat.messages').set({ payload: JSON.stringify(payload) }).where('id', '=', messageId).execute();
    const full = await this.messageById(messageId);
    await this.broadcast(full.conversation_id, 'message.updated', full);
    return full;
  }

  /** Siarkan ke anggota lewat bus lintas proses. Pesan dikirim sebagai id (API mengambil isinya), event lain membawa data. */
  async broadcast(convId: string, event: string, data: unknown) {
    const members = await getDb().selectFrom('chat.participants').select('user_id').where('conversation_id', '=', convId).where('left_at', 'is', null).execute();
    const msg = data as { id?: string } | null;
    if ((event === 'message' || event === 'message.updated') && msg?.id) await emitChat({ conversationId: convId, recipientUserIds: members.map((m) => m.user_id), event, messageId: msg.id });
    else await emitChat({ conversationId: convId, recipientUserIds: members.map((m) => m.user_id), event, data });
  }

  async markRead(me: Principal, convId: string, seq: number) {
    await this.assertMember(convId, me.userId);
    await getDb().updateTable('chat.participants').set({ last_read_seq: sql`greatest(last_read_seq, ${seq})` }).where('conversation_id', '=', convId).where('user_id', '=', me.userId).execute();
    return { ok: true };
  }

  async addMembers(me: Principal, convId: string, memberIds: string[]) {
    const role = await this.assertMember(convId, me.userId);
    const conv = await getDb().selectFrom('chat.conversations').select('type').where('id', '=', convId).executeTakeFirstOrThrow();
    if (conv.type !== 'GROUP' || role !== 'ADMIN') throw E.forbidden('Hanya admin grup.');
    for (const uid of memberIds) {
      await getDb().insertInto('chat.participants').values({ conversation_id: convId, user_id: uid, role: 'MEMBER' }).onConflict((oc) => oc.columns(['conversation_id', 'user_id']).doUpdateSet({ left_at: null })).execute();
    }
    await audit({ actorUserId: me.userId, action: 'chat.group.add_members', targetType: 'conversation', targetId: convId, details: { memberIds } });
    return { ok: true };
  }
}
