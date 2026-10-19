'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from '@/components/Session';
import { get, post, errMsg } from '@/lib/api';
import type { AttendanceMine, LeaveCardPayload } from '@/lib/types';
import { fmtDate } from '@/lib/time';
import { LeaveCard, LeaveForm } from '@/components/LeaveCard';
import { Badge, Button, Spinner } from '@/components/ui';
import { useToast } from '@/components/Toast';

export default function SayaPage() {
  const { me, onWs } = useSession();
  const { toast } = useToast();
  const [requests, setRequests] = useState<LeaveCardPayload[] | null>(null);
  const [att, setAtt] = useState<AttendanceMine | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    get<LeaveCardPayload[] | { items: LeaveCardPayload[] }>('/hr/requests/mine')
      .then((r) => setRequests(Array.isArray(r) ? r : (r.items ?? [])))
      .catch((e) => toast(errMsg(e), 'error'));
    get<AttendanceMine>('/hr/attendance/mine')
      .then(setAtt)
      .catch(() => setAtt({ source: 'Belum terhubung', connected: false, notes: [] }));
  }, [toast]);

  useEffect(load, [load]);
  useEffect(() => onWs((ev) => ev.event === 'message.updated' && load()), [onWs, load]);

  async function logout() {
    setBusy('logout');
    try {
      const r = await post<{ ok: boolean; redirect?: string; ssoEnded?: boolean; note?: string }>('/auth/chat/logout');
      if (r.note && !r.ssoEnded) toast(r.note);
      window.location.href = r.redirect || '/masuk';
    } catch (e) {
      toast(errMsg(e), 'error');
      setBusy(null);
    }
  }

  async function logoutAll() {
    if (!window.confirm('Keluar dari semua perangkat?')) return;
    setBusy('all');
    try {
      const r = await post<{ ok: boolean; redirect?: string }>('/auth/chat/logout-all');
      window.location.href = r.redirect || '/masuk';
    } catch (e) {
      toast(errMsg(e), 'error');
      setBusy(null);
    }
  }

  const sourceLabel = att ? (att.connected ? (att.source ?? 'ERP') : att.source === 'DEMO' ? 'DEMO' : 'Belum terhubung') : '';

  return (
    <div className="space-y-5 px-4 pt-4">
      <section className="rounded-card border border-gray-200 bg-white p-4">
        <div className="text-[20px] font-semibold text-ink">{me?.displayName}</div>
        <div className="text-[14px] text-muted">@{me?.username}</div>
        {me?.employeeId ? <div className="mt-1 text-[13px] text-muted">ID karyawan {me.employeeId}</div> : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {me?.isHr ? <Badge tone="ok">Petugas HR</Badge> : null}
          {me?.isApprover ? <Badge tone="ok">Atasan</Badge> : null}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-ink">Pengajuan saya</h2>
          <Button variant="primary" onClick={() => setFormOpen(true)}>
            Ajukan izin
          </Button>
        </div>
        {requests === null ? (
          <Spinner />
        ) : requests.length === 0 ? (
          <div className="rounded-card border border-gray-200 bg-white p-4 text-[14px] text-muted">Belum ada pengajuan.</div>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <LeaveCard key={r.requestId} card={r} onChanged={load} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-ink">Jadwal & absensi</h2>
          {att ? <Badge tone={att.connected ? 'ok' : att.source === 'DEMO' ? 'wait' : 'muted'}>{sourceLabel}</Badge> : null}
        </div>
        <div className="rounded-card border border-gray-200 bg-white p-4 text-[14px] text-ink">
          {!att ? (
            <Spinner />
          ) : (
            <>
              <div className="flex gap-2">
                <span className="w-24 shrink-0 text-muted">Shift hari ini</span>
                <span>
                  {att.shift?.shiftCode ? `Shift ${att.shift.shiftCode}${att.shift.crossesMidnight ? ' (lintas tengah malam)' : ''}` : 'Tidak ada data'}
                </span>
              </div>
              <div className="mt-3 border-t border-gray-100 pt-3">
                <div className="mb-1 text-[13px] font-medium text-muted">Catatan absensi</div>
                {(att.notes ?? []).length === 0 ? (
                  <div className="text-muted">Belum ada catatan.</div>
                ) : (
                  <ul className="space-y-1">
                    {(att.notes ?? []).map((n, i) => (
                      <li key={i} className="flex flex-wrap gap-x-2">
                        <span className="w-28 shrink-0">{fmtDate(n.work_date)}</span>
                        <span className="font-medium">{n.note_type}</span>
                        {n.note ? <span className="text-muted">{n.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="space-y-2 pb-4">
        <Button onClick={logout} loading={busy === 'logout'} disabled={busy !== null}>
          Keluar dari aplikasi ini
        </Button>
        <div>
          <Button variant="danger" onClick={logoutAll} loading={busy === 'all'} disabled={busy !== null}>
            Keluar dari semua perangkat
          </Button>
        </div>
      </section>

      {formOpen && (
        <LeaveForm
          title="Ajukan izin"
          onClose={() => setFormOpen(false)}
          onSubmit={async (v) => {
            await post('/hr/requests', v);
            toast('Pengajuan dikirim');
            setFormOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}
