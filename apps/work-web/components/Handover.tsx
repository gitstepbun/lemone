'use client';

import { fmtDate } from '@/lib/format';
import { CopyButton } from './ui';

export type Handover = {
  username: string;
  temporaryPassword: string | null;
  activationUrl: string;
  expiresAt: string;
  delivery: 'HR_HANDOVER' | 'EMAIL';
  emailStatus?: string;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-yellow-200 py-2 last:border-0">
      <div className="min-w-0">
        <div className="text-[13px] text-muted">{label}</div>
        <div className="break-all font-mono text-[15px] text-ink">{value}</div>
      </div>
      <CopyButton value={value} />
    </div>
  );
}

export function HandoverPanel({ h }: { h: Handover }) {
  return (
    <div className="rounded-panel border-2 border-lemone bg-yellow-50 p-4">
      <p className="mb-3 text-[17px] font-bold text-danger">Tampil sekali. Tidak disimpan.</p>
      <Row label="Username" value={h.username} />
      {h.temporaryPassword && <Row label="Kata sandi sementara" value={h.temporaryPassword} />}
      <Row label="Tautan aktivasi" value={h.activationUrl} />
      <Row label="Berlaku sampai" value={fmtDate(h.expiresAt)} />
      {h.delivery === 'EMAIL' && <p className="mt-3 text-[13px] text-muted">Email belum terhubung, tautan tetap ditampilkan untuk diserahkan manual.</p>}
    </div>
  );
}
