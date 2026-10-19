import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { audit } from '../common/audit';
import { E } from '../common/errors';
import { businessDate, formatId } from '../common/time';
import { getDb } from '../db/db';
import type { LeaveStatus, LeaveType } from '../db/types';
import { erp } from '../erp/erp.provider';
import type { Principal } from '../auth/principal';
import { ChatService } from '../chat/chat.service';
import { emitOutbox } from '../provisioning/jobs';
import { parseLeaveMessage, type ParseResult } from './leave-parser';

const TYPE_LABEL: Record<LeaveType, string> = { IZIN: 'Izin tidak masuk', SAKIT: 'Sakit', CUTI: 'Cuti', TERLAMBAT: 'Terlambat', PULANG_AWAL: 'Pulang lebih awal' };
const STATUS_LABEL: Record<LeaveStatus, string> = { PENDING_APPROVAL: 'Menunggu persetujuan', APPROVED: 'Disetujui', REJECTED: 'Ditolak', CANCELLED: 'Dibatalkan', NEEDS_INFO: 'Perlu dilengkapi' };
const SYNC_LABEL: Record<string, string> = { NOT_SENT: 'Belum dikirim ke absensi', PENDING: 'Mengirim ke absensi', SYNCED: 'Tercatat di absensi', FAILED: 'Gagal dicatat, akan dicoba lagi', AMBIGUOUS: 'Menunggu rekonsiliasi absensi', NOT_CONNECTED: 'Absensi belum terhubung' };

export interface LeaveRow {
  id: string; employee_user_id: string; employee_id: string; type: LeaveType; date_from: string; date_to: string; shift_code: string | null; reason: string | null;
  status: LeaveStatus; erp_sync_status: string; erp_reference: string | null; erp_last_error: string | null; version: number; conversation_id: string | null; card_message_id: string | null;
  decided_by: string | null; decided_at: Date | null; decision_note: string | null; created_at: Date; updated_at: Date; source: 'CHAT' | 'MANUAL';
}

function ymd(d: Date | string): string { return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10); }

@Injectable()
export class LeaveService {
  constructor(@Inject(ChatService) private readonly chat: ChatService) {}

  cardPayload(r: LeaveRow, extra: Record<string, unknown> = {}) {
    const from = ymd(r.date_from); const to = ymd(r.date_to);
    return {
      card: 'LEAVE_REQUEST',
      requestId: r.id,
      type: r.type, typeLabel: TYPE_LABEL[r.type],
      dateFrom: from, dateTo: to,
      dateLabel: from === to ? formatId(from) : `${formatId(from)} s.d. ${formatId(to)}`,
      shift: r.shift_code, shiftLabel: r.shift_code ? `Shift ${r.shift_code}${r.shift_code === 'MALAM' ? ' (lintas tengah malam)' : ''}` : null,
      reason: r.reason,
      status: r.status, statusLabel: STATUS_LABEL[r.status],
      erpSync: r.erp_sync_status, erpSyncLabel: SYNC_LABEL[r.erp_sync_status] ?? r.erp_sync_status, erpReference: r.erp_reference,
      version: r.version,
      actions: r.status === 'PENDING_APPROVAL' || r.status === 'NEEDS_INFO' ? ['UBAH', 'BATALKAN'] : r.status === 'APPROVED' ? ['BATALKAN'] : [],
      decidedAt: r.decided_at, decisionNote: r.decision_note,
      ...extra,
    };
  }

  private async get(id: string): Promise<LeaveRow> {
    const r = await getDb().selectFrom('hr.leave_requests').selectAll().where('id', '=', id).executeTakeFirst();
    if (!r) throw E.notFound('Pengajuan');
    return r as unknown as LeaveRow;
  }

  private async history(id: string, actor: string | null, action: string, snapshot: unknown) {
    await getDb().insertInto('hr.leave_request_history').values({ request_id: id, actor_user_id: actor, action, snapshot: JSON.stringify(snapshot) }).execute();
  }

  /** Jalankan deteksi untuk pesan teks karyawan di inbox HR. Hanya kanal HR, bukan semua DM. */
  async handleInboxMessage(me: Principal, message: { id: string; conversation_id: string; body: string | null; forwarded: boolean; reply_to_id: string | null; kind: string }) {
    if (message.kind === 'VOICE') {
      const svc = await this.chat.serviceUser('HR_INBOX');
      await this.chat.sendAsService(message.conversation_id, svc.user_id, { kind: 'SYSTEM', body: 'Voice note belum bisa dibaca otomatis. Ketik pengajuan Anda atau tunggu petugas HR membacanya.' });
      return { intent: 'NONE' };
    }
    if (message.kind !== 'TEXT' || !message.body) return { intent: 'NONE' };
    const today = businessDate();
    const parsed = parseLeaveMessage(message.body, { today, forwarded: message.forwarded, quoted: Boolean(message.reply_to_id) });
    const svc = await this.chat.serviceUser('HR_INBOX');

    // Pelengkapan pengajuan NEEDS_INFO terakhir (dalam 30 menit)
    const open = await getDb().selectFrom('hr.leave_requests').selectAll().where('employee_user_id', '=', me.userId).where('status', '=', 'NEEDS_INFO').where('updated_at', '>', new Date(Date.now() - 30 * 60_000)).orderBy('updated_at', 'desc').executeTakeFirst();
    if (open && parsed.intent !== 'QUESTION' && parsed.intent !== 'NEGATION') {
      const dates = parseLeaveMessage(`izin ${message.body}`, { today });
      if (dates.dateFrom) {
        await getDb().updateTable('hr.leave_requests').set({ date_from: dates.dateFrom, date_to: dates.dateTo ?? dates.dateFrom, status: 'PENDING_APPROVAL', reason: open.reason ?? parsed.reason, version: sql`version + 1`, updated_at: new Date() }).where('id', '=', open.id).execute();
        const r = await this.get(open.id);
        await this.history(r.id, me.userId, 'COMPLETED_INFO', r);
        await this.refreshCard(r);
        await this.notifyOfficers(r, 'Pengajuan baru menunggu persetujuan');
        return { intent: 'LEAVE_REQUEST', requestId: r.id };
      }
    }

    switch (parsed.intent) {
      case 'NONE':
        return { intent: 'NONE', notes: parsed.notes };
      case 'QUESTION':
        return { intent: 'QUESTION' };
      case 'NEGATION': {
        const pending = await getDb().selectFrom('hr.leave_requests').select(['id']).where('employee_user_id', '=', me.userId).where('status', 'in', ['PENDING_APPROVAL', 'NEEDS_INFO', 'APPROVED']).orderBy('created_at', 'desc').executeTakeFirst();
        await this.chat.sendAsService(message.conversation_id, svc.user_id, {
          kind: 'CARD',
          body: pending ? 'Ingin membatalkan pengajuan terakhir? Tekan Batalkan pada kartunya.' : 'Tidak ada pengajuan aktif yang bisa dibatalkan.',
          payload: { card: 'HINT', requestId: pending?.id ?? null },
        });
        return { intent: 'NEGATION' };
      }
      case 'AMBIGUOUS':
        await this.chat.sendAsService(message.conversation_id, svc.user_id, {
          kind: 'CARD', body: 'Tanggalnya belum jelas. Pilih atau ketik tanggalnya.',
          payload: { card: 'ASK', askingFor: 'date', quickReplies: ['Hari ini', 'Besok', 'Lusa'], notes: parsed.notes },
        });
        await this.createNeedsInfo(me, message, parsed);
        return { intent: 'AMBIGUOUS' };
      case 'LEAVE_REQUEST': {
        if (parsed.missing.includes('date')) {
          await this.createNeedsInfo(me, message, parsed);
          await this.chat.sendAsService(message.conversation_id, svc.user_id, {
            kind: 'CARD', body: `${TYPE_LABEL[parsed.type!]}: tanggal berapa?`,
            payload: { card: 'ASK', askingFor: 'date', quickReplies: ['Hari ini', 'Besok', 'Lusa'] },
          });
          return { intent: 'NEEDS_INFO' };
        }
        const r = await this.create(me, { type: parsed.type!, dateFrom: parsed.dateFrom!, dateTo: parsed.dateTo!, reason: parsed.reason, source: 'CHAT', sourceMessageId: message.id, conversationId: message.conversation_id });
        return { intent: 'LEAVE_REQUEST', requestId: r.id };
      }
    }
  }

  private async createNeedsInfo(me: Principal, message: { id: string; conversation_id: string }, parsed: ParseResult) {
    const existing = await getDb().selectFrom('hr.leave_requests').select('id').where('employee_user_id', '=', me.userId).where('status', '=', 'NEEDS_INFO').executeTakeFirst();
    if (existing) {
      await getDb().updateTable('hr.leave_requests').set({ type: parsed.type ?? 'IZIN', reason: parsed.reason, updated_at: new Date() }).where('id', '=', existing.id).execute();
      return existing.id;
    }
    const today = businessDate();
    const r = await getDb()
      .insertInto('hr.leave_requests')
      .values({ employee_user_id: me.userId, employee_id: me.employeeId ?? '', type: parsed.type ?? 'IZIN', date_from: today, date_to: today, shift_code: null, reason: parsed.reason, source: 'CHAT', source_message_id: message.id, conversation_id: message.conversation_id, status: 'NEEDS_INFO' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.history(r.id, me.userId, 'CREATED_NEEDS_INFO', parsed);
    return r.id;
  }

  async create(me: Principal, input: { type: LeaveType; dateFrom: string; dateTo: string; reason: string | null; source: 'CHAT' | 'MANUAL'; sourceMessageId?: string; conversationId?: string }) {
    if (!me.employeeId) throw E.forbidden('Akun tanpa nomor karyawan.');
    if (input.dateTo < input.dateFrom) throw E.invalid('Rentang tanggal terbalik.');
    const shift = await erp().getShift(me.employeeId, input.dateFrom).catch(() => null);
    const db = getDb();
    // satu pengajuan aktif per tanggal mulai
    const dup = await db.selectFrom('hr.leave_requests').select('id').where('employee_user_id', '=', me.userId).where('date_from', '=', input.dateFrom).where('status', 'in', ['PENDING_APPROVAL', 'APPROVED']).executeTakeFirst();
    if (dup) throw E.conflict('DUPLICATE_REQUEST', 'Sudah ada pengajuan aktif untuk tanggal itu.', { requestId: dup.id });
    let convId = input.conversationId;
    if (!convId) {
      await this.chat.ensureServiceConversations(me.userId);
      convId = (await db.selectFrom('chat.conversations').select('id').where('dm_key', '=', `hr_inbox:${me.userId}`).executeTakeFirstOrThrow()).id;
    }
    const row = await db
      .insertInto('hr.leave_requests')
      .values({ employee_user_id: me.userId, employee_id: me.employeeId, type: input.type, date_from: input.dateFrom, date_to: input.dateTo, shift_code: shift?.shiftCode ?? null, reason: input.reason, source: input.source, source_message_id: input.sourceMessageId ?? null, conversation_id: convId, status: 'PENDING_APPROVAL' })
      .returningAll()
      .executeTakeFirstOrThrow();
    const r = row as unknown as LeaveRow;
    await this.history(r.id, me.userId, 'CREATED', r);
    await audit({ actorUserId: me.userId, action: 'leave.create', targetType: 'leave_request', targetId: r.id, details: { type: r.type, dateFrom: input.dateFrom, dateTo: input.dateTo, source: input.source } });
    const svc = await this.chat.serviceUser('HR_INBOX');
    const card = await this.chat.sendAsService(convId, svc.user_id, { kind: 'CARD', body: 'Pengajuan diterima, menunggu persetujuan.', payload: this.cardPayload(r) });
    await db.updateTable('hr.leave_requests').set({ card_message_id: card.id }).where('id', '=', r.id).execute();
    await this.notifyOfficers(r, 'Pengajuan baru menunggu persetujuan');
    return { ...r, card_message_id: card.id };
  }

  private async refreshCard(r: LeaveRow, extra: Record<string, unknown> = {}) {
    if (r.card_message_id) await this.chat.updateCard(r.card_message_id, this.cardPayload(r, extra));
    else if (r.conversation_id) {
      const svc = await this.chat.serviceUser('HR_INBOX');
      const card = await this.chat.sendAsService(r.conversation_id, svc.user_id, { kind: 'CARD', body: 'Pengajuan', payload: this.cardPayload(r, extra) });
      await getDb().updateTable('hr.leave_requests').set({ card_message_id: card.id }).where('id', '=', r.id).execute();
    }
  }

  private async notifyOfficers(r: LeaveRow, text: string) {
    if (!r.conversation_id) return;
    await this.chat.broadcast(r.conversation_id, 'hr.queue', { requestId: r.id, status: r.status, text });
  }

  async myRequests(me: Principal) {
    const rows = await getDb().selectFrom('hr.leave_requests').selectAll().where('employee_user_id', '=', me.userId).orderBy('created_at', 'desc').limit(50).execute();
    return rows.map((r) => this.cardPayload(r as unknown as LeaveRow, { createdAt: r.created_at }));
  }

  async update(me: Principal, id: string, input: { type?: LeaveType; dateFrom?: string; dateTo?: string; reason?: string | null }) {
    const r = await this.get(id);
    if (r.employee_user_id !== me.userId) throw E.forbidden();
    if (!['PENDING_APPROVAL', 'NEEDS_INFO'].includes(r.status)) throw E.conflict('NOT_EDITABLE', 'Pengajuan tidak bisa diubah lagi.');
    const from = input.dateFrom ?? ymd(r.date_from); const to = input.dateTo ?? (input.dateFrom ?? ymd(r.date_to));
    if (to < from) throw E.invalid('Rentang tanggal terbalik.');
    await getDb().updateTable('hr.leave_requests').set({ type: input.type ?? r.type, date_from: from, date_to: to, reason: input.reason === undefined ? r.reason : input.reason, status: 'PENDING_APPROVAL', version: sql`version + 1`, updated_at: new Date() }).where('id', '=', id).execute();
    const n = await this.get(id);
    await this.history(id, me.userId, 'UPDATED', n);
    await audit({ actorUserId: me.userId, action: 'leave.update', targetType: 'leave_request', targetId: id, details: { version: n.version } });
    await this.refreshCard(n);
    return this.cardPayload(n);
  }

  async cancel(me: Principal, id: string) {
    const r = await this.get(id);
    if (r.employee_user_id !== me.userId) throw E.forbidden();
    if (!['PENDING_APPROVAL', 'NEEDS_INFO', 'APPROVED'].includes(r.status)) throw E.conflict('NOT_CANCELLABLE', 'Pengajuan tidak bisa dibatalkan.');
    const wasApproved = r.status === 'APPROVED';
    await getDb().updateTable('hr.leave_requests').set({ status: 'CANCELLED', version: sql`version + 1`, updated_at: new Date() }).where('id', '=', id).execute();
    const n = await this.get(id);
    await this.history(id, me.userId, 'CANCELLED', n);
    await audit({ actorUserId: me.userId, action: 'leave.cancel', targetType: 'leave_request', targetId: id, details: { wasApproved } });
    if (wasApproved && (r.erp_sync_status === 'SYNCED' || r.erp_sync_status === 'PENDING')) {
      // Pembatalan izin yang sudah tercatat: kirim koreksi ke ERP; izin tetap berlaku sampai koreksi sah tercatat.
      await getDb().updateTable('hr.leave_requests').set({ erp_sync_status: 'PENDING' }).where('id', '=', id).execute();
      await emitOutbox({ aggregate: 'leave_request', aggregateId: id, type: 'LEAVE_CANCELLED_AFTER_APPROVAL', payload: { requestId: id, version: n.version } });
    }
    await this.refreshCard(await this.get(id));
    return this.cardPayload(await this.get(id));
  }

  /** Antrean keputusan: HR dalam cakupan divisi, atau atasan langsung (APPROVER) karyawan. */
  async queue(me: Principal, status: LeaveStatus | 'ALL' = 'PENDING_APPROVAL') {
    const scope = await this.decisionScope(me);
    if (!scope.hr && !scope.managerOf.length) throw E.forbidden('Bukan petugas HR atau atasan.');
    let q = getDb()
      .selectFrom('hr.leave_requests as r')
      .innerJoin('directory.users as u', 'u.id', 'r.employee_user_id')
      .leftJoin('directory.employee_directory as e', (j) => j.onRef('e.employee_id', '=', 'r.employee_id').on('e.org_id', '=', 'lemone'))
      .selectAll('r')
      .select(['u.display_name', 'u.username', 'e.division', 'e.position'])
      .where('r.employee_user_id', '!=', me.userId)
      .where((eb) => {
        const conds = [];
        if (scope.hr === 'ALL') conds.push(eb.val(true));
        else if (scope.hr) conds.push(eb('e.division', 'in', scope.hr));
        if (scope.managerOf.length) conds.push(eb('r.employee_id', 'in', scope.managerOf));
        return eb.or(conds);
      });
    if (status !== 'ALL') q = q.where('r.status', '=', status);
    const rows = await q.orderBy('r.created_at', 'desc').limit(100).execute();
    return rows.map((r) => ({ ...this.cardPayload(r as unknown as LeaveRow), employee: { displayName: r.display_name, username: r.username, division: r.division, position: r.position, employeeId: r.employee_id }, createdAt: r.created_at, source: r.source }));
  }

  private async decisionScope(me: Principal): Promise<{ hr: 'ALL' | string[] | null; managerOf: string[] }> {
    const hr = me.hrDivisions === undefined ? null : me.hrDivisions === null ? 'ALL' : me.hrDivisions;
    let managerOf: string[] = [];
    if (me.employeeId && me.roles.some((r) => r.role === 'APPROVER')) {
      const subs = await getDb().selectFrom('directory.employee_directory').select('employee_id').where('manager_employee_id', '=', me.employeeId).execute();
      managerOf = subs.map((s) => s.employee_id);
    }
    return { hr, managerOf };
  }

  async decide(me: Principal, id: string, decision: 'APPROVED' | 'REJECTED', note: string | null) {
    const r = await this.get(id);
    if (r.employee_user_id === me.userId) throw E.forbidden('Tidak bisa menyetujui pengajuan sendiri.');
    if (r.status !== 'PENDING_APPROVAL') throw E.conflict('NOT_PENDING', 'Pengajuan tidak sedang menunggu persetujuan.');
    const scope = await this.decisionScope(me);
    const division = (await getDb().selectFrom('directory.employee_directory').select('division').where('employee_id', '=', r.employee_id).executeTakeFirst())?.division ?? '';
    const allowed = scope.hr === 'ALL' || (Array.isArray(scope.hr) && scope.hr.includes(division)) || scope.managerOf.includes(r.employee_id);
    if (!allowed) throw E.forbidden('Pengajuan di luar cakupan Anda.');
    const upd = await getDb()
      .updateTable('hr.leave_requests')
      .set({ status: decision, decided_by: me.userId, decided_at: new Date(), decision_note: note, erp_sync_status: decision === 'APPROVED' ? (erp().connected || erp().name === 'demo' ? 'PENDING' : 'NOT_CONNECTED') : 'NOT_SENT', version: sql`version + 1`, updated_at: new Date() })
      .where('id', '=', id)
      .where('status', '=', 'PENDING_APPROVAL')
      .executeTakeFirst();
    if (Number(upd.numUpdatedRows) !== 1) throw E.conflict('RACE', 'Pengajuan sudah diputuskan.');
    const n = await this.get(id);
    await this.history(id, me.userId, decision, n);
    await audit({ actorUserId: me.userId, action: `leave.${decision.toLowerCase()}`, targetType: 'leave_request', targetId: id, details: { employeeId: r.employee_id, note } });
    if (decision === 'APPROVED' && n.erp_sync_status === 'PENDING') await emitOutbox({ aggregate: 'leave_request', aggregateId: id, type: 'LEAVE_APPROVED', payload: { requestId: id, version: n.version } });
    if (n.conversation_id) {
      const svc = await this.chat.serviceUser('HR_INBOX');
      await getDb().transaction().execute((trx) => this.chat.insertMessage(trx, n.conversation_id!, me.userId, { kind: 'TEXT', body: decision === 'APPROVED' ? `Disetujui${note ? `. ${note}` : '.'}` : `Ditolak${note ? `. ${note}` : '.'}`, viaServiceUserId: svc.user_id }));
      const last = await getDb().selectFrom('chat.messages').select('id').where('conversation_id', '=', n.conversation_id).orderBy('seq', 'desc').executeTakeFirstOrThrow();
      await this.chat.broadcast(n.conversation_id, 'message', await this.chat.messageById(last.id));
    }
    await this.refreshCard(n, { decidedByName: me.displayName });
    return this.cardPayload(n, { decidedByName: me.displayName });
  }

  /** Dipanggil worker dari outbox: kirim ke ERP secara idempoten, pisahkan status keputusan dari status sinkron. */
  async syncApprovedToErp(requestId: string, version: number, mode: 'NOTE' | 'CANCEL') {
    const r = await this.get(requestId);
    const sourceRef = mode === 'NOTE' ? `leave:${r.id}:v${version}` : `leave-cancel:${r.id}:v${version}`;
    const adapter = erp();
    if (!adapter.connected && adapter.name !== 'demo') {
      await getDb().updateTable('hr.leave_requests').set({ erp_sync_status: 'NOT_CONNECTED', erp_last_error: 'ERP belum terhubung' }).where('id', '=', r.id).execute();
      await this.refreshCard(await this.get(r.id));
      return;
    }
    // Rekonsiliasi: bila sebelumnya ambigu, cek dulu apakah sudah tercatat.
    if (r.erp_sync_status === 'AMBIGUOUS') {
      const found = await adapter.findAttendanceNote(sourceRef);
      if (found) { await this.markSynced(r.id, found.reference); return; }
    }
    const decider = r.decided_by ? await getDb().selectFrom('directory.users').select('employee_id').where('id', '=', r.decided_by).executeTakeFirst() : null;
    const res = await adapter.postAttendanceNote({
      sourceRef, employeeId: r.employee_id, dateFrom: ymd(r.date_from), dateTo: ymd(r.date_to),
      noteType: r.type, note: mode === 'CANCEL' ? `DIBATALKAN: ${r.reason ?? ''}` : r.reason, approvedByEmployeeId: decider?.employee_id ?? null, approvedAt: (r.decided_at ?? new Date()).toISOString(),
    });
    await getDb().updateTable('hr.leave_requests').set({ erp_attempts: sql`erp_attempts + 1` }).where('id', '=', r.id).execute();
    if (res.ok === true) { await this.markSynced(r.id, res.reference); return; }
    if (res.ok === 'ambiguous') {
      await getDb().updateTable('hr.leave_requests').set({ erp_sync_status: 'AMBIGUOUS', erp_last_error: res.error }).where('id', '=', r.id).execute();
      await this.refreshCard(await this.get(r.id));
      throw new Error(`ERP ambigu: ${res.error}`); // retry → rekonsiliasi
    }
    await getDb().updateTable('hr.leave_requests').set({ erp_sync_status: 'FAILED', erp_last_error: res.error }).where('id', '=', r.id).execute();
    await this.refreshCard(await this.get(r.id));
    if (res.retryable) throw new Error(`ERP gagal sementara: ${res.error}`);
    await audit({ actorKind: 'WORKER', action: 'leave.erp_sync', targetType: 'leave_request', targetId: r.id, outcome: 'FAILED', details: { error: res.error } });
  }

  private async markSynced(id: string, reference: string) {
    await getDb().updateTable('hr.leave_requests').set({ erp_sync_status: 'SYNCED', erp_reference: reference, erp_last_error: null }).where('id', '=', id).execute();
    await audit({ actorKind: 'WORKER', action: 'leave.erp_sync', targetType: 'leave_request', targetId: id, details: { reference } });
    await this.refreshCard(await this.get(id));
  }

  /** Jadwal & absensi pribadi (proyeksi dari ERP/DEMO) untuk tab Saya. */
  async myAttendance(me: Principal) {
    if (!me.employeeId) return { source: erp().label, connected: erp().connected, shift: null, notes: [] };
    const shift = await erp().getShift(me.employeeId, businessDate()).catch(() => null);
    const notes = erp().name === 'demo'
      ? await getDb().selectFrom('ops.erp_demo_attendance_notes').select(['work_date', 'note_type', 'note', 'source_ref', 'created_at']).where('employee_id', '=', me.employeeId).orderBy('work_date', 'desc').limit(30).execute()
      : [];
    return { source: erp().label, connected: erp().connected, syncedAt: new Date().toISOString(), shift, notes };
  }
}
