'use client';

import { useState } from 'react';
import type { LeaveCardPayload } from '@/lib/types';
import { post, errMsg } from '@/lib/api';
import { LEAVE_TYPES, statusTone } from '@/lib/labels';
import { Badge, Button, Input, Label, Modal, Select, Textarea } from './ui';
import { useToast } from './Toast';

export function LeaveCard({
  card,
  compact,
  onChanged,
}: {
  card: LeaveCardPayload;
  compact?: boolean;
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const actions = card.actions ?? [];
  const canEdit = actions.includes('UBAH');
  const canCancel = actions.includes('BATALKAN');

  async function cancel() {
    if (!window.confirm('Batalkan pengajuan ini?')) return;
    setBusy(true);
    try {
      await post(`/hr/requests/${card.requestId}/cancel`);
      toast('Pengajuan dibatalkan');
      onChanged?.();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-card border border-gray-200 bg-white ${compact ? 'p-3' : 'p-3.5'} text-[14px] text-ink`}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold">{card.typeLabel}</div>
        <Badge tone={statusTone(card.status)}>{card.statusLabel}</Badge>
      </div>
      <div className="mt-1.5 space-y-0.5">
        <Row k="Tanggal" v={card.dateLabel} />
        {card.shiftLabel ? <Row k="Shift" v={card.shiftLabel} /> : null}
        {card.reason ? <Row k="Alasan" v={card.reason} /> : null}
        {card.decidedByName ? <Row k="Oleh" v={card.decidedByName} /> : null}
        {card.decisionNote ? <Row k="Catatan" v={card.decisionNote} /> : null}
      </div>
      {card.erpSyncLabel ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
          <span>Absensi:</span>
          <Badge tone={statusTone(card.erpSync)}>{card.erpSyncLabel}</Badge>
          {card.erpReference ? <span className="font-mono text-[12px]">{card.erpReference}</span> : null}
        </div>
      ) : null}
      {(canEdit || canCancel) && (
        <div className="mt-3 flex gap-2">
          {canEdit && (
            <Button size="sm" onClick={() => setEditing(true)} disabled={busy}>
              Ubah
            </Button>
          )}
          {canCancel && (
            <Button size="sm" variant="danger" onClick={cancel} loading={busy}>
              Batalkan
            </Button>
          )}
        </div>
      )}
      {editing && (
        <LeaveForm
          title="Ubah pengajuan"
          initial={{ type: card.type, dateFrom: card.dateFrom, dateTo: card.dateTo ?? '', reason: card.reason ?? '' }}
          onClose={() => setEditing(false)}
          onSubmit={async (v) => {
            await post(`/hr/requests/${card.requestId}/update`, v);
            toast('Pengajuan diubah');
            setEditing(false);
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-muted">{k}</span>
      <span className="break-words">{v}</span>
    </div>
  );
}

export interface LeaveFormValue {
  type: string;
  dateFrom: string;
  dateTo: string;
  reason: string;
}

export function LeaveForm({
  title,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  initial?: Partial<LeaveFormValue>;
  onClose: () => void;
  onSubmit: (v: { type: string; dateFrom: string; dateTo?: string; reason?: string }) => Promise<void>;
}) {
  const { toast } = useToast();
  const [v, setV] = useState<LeaveFormValue>({
    type: initial?.type && LEAVE_TYPES.some((t) => t.value === initial.type) ? initial.type : LEAVE_TYPES[0].value,
    dateFrom: initial?.dateFrom ?? '',
    dateTo: initial?.dateTo ?? '',
    reason: initial?.reason ?? '',
  });
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!v.dateFrom) {
      toast('Tanggal mulai wajib diisi', 'error');
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        type: v.type,
        dateFrom: v.dateFrom,
        dateTo: v.dateTo || undefined,
        reason: v.reason.trim() || undefined,
      });
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <Label>Jenis</Label>
          <Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
            {LEAVE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Tanggal mulai</Label>
            <Input type="date" value={v.dateFrom} onChange={(e) => setV({ ...v, dateFrom: e.target.value })} />
          </div>
          <div>
            <Label>Tanggal selesai</Label>
            <Input type="date" value={v.dateTo} min={v.dateFrom || undefined} onChange={(e) => setV({ ...v, dateTo: e.target.value })} />
          </div>
        </div>
        <div>
          <Label>Alasan</Label>
          <Textarea rows={3} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Simpan
          </Button>
        </div>
      </div>
    </Modal>
  );
}
