'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/components/Session';
import { get, post, errMsg } from '@/lib/api';
import type { QueueItem } from '@/lib/types';
import { statusTone } from '@/lib/labels';
import { Badge, Button, Spinner } from '@/components/ui';
import { useToast } from '@/components/Toast';

type Tab = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'PENDING_APPROVAL', label: 'Menunggu' },
  { key: 'APPROVED', label: 'Disetujui' },
  { key: 'REJECTED', label: 'Ditolak' },
];

export default function HrPage() {
  const { me, conversations, hrQueueTick, setHrCount } = useSession();
  const { toast } = useToast();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('PENDING_APPROVAL');
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    (silent = false) => {
      if (!silent) setItems(null);
      get<QueueItem[] | { items: QueueItem[] }>(`/hr/queue?status=${tab}`)
        .then((r) => {
          const list = Array.isArray(r) ? r : (r.items ?? []);
          setItems(list);
          if (tab === 'PENDING_APPROVAL') setHrCount(list.length);
        })
        .catch((e) => {
          toast(errMsg(e), 'error');
          setItems([]);
        });
    },
    [tab, toast, setHrCount],
  );

  useEffect(() => load(), [load]);
  useEffect(() => {
    if (hrQueueTick > 0) load(true);
  }, [hrQueueTick, load]);

  useEffect(() => {
    if (me && !me.isHr && !me.isApprover) router.replace('/');
  }, [me, router]);

  async function decide(it: QueueItem, decision: 'APPROVED' | 'REJECTED') {
    const id = it.requestId ?? it.id ?? '';
    const note = window.prompt(decision === 'APPROVED' ? 'Catatan (opsional)' : 'Alasan penolakan (opsional)');
    if (note === null) return;
    setBusy(id);
    try {
      await post(`/hr/requests/${id}/decide`, { decision, note: note.trim() || undefined });
      toast(decision === 'APPROVED' ? 'Disetujui' : 'Ditolak');
      load(true);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  function chatLink(it: QueueItem): string | null {
    const username = it.employee?.username ?? it.username;
    if (!username) return null;
    const c = conversations.find((x) => x.type === 'HR_INBOX' && x.username === username);
    return c ? `/c/${c.id}` : null;
  }

  return (
    <div className="px-4 pt-4">
      <h1 className="mb-3 text-[22px] font-semibold text-ink">HR</h1>
      <div className="mb-3 flex gap-1 rounded-field border border-gray-200 bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-[8px] py-1.5 text-[14px] font-medium ${tab === t.key ? 'bg-lemone text-ink' : 'text-muted hover:bg-gray-50'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {items === null ? (
        <Spinner />
      ) : items.length === 0 ? (
        <div className="rounded-card border border-gray-200 bg-white p-4 text-[14px] text-muted">
          {tab === 'PENDING_APPROVAL' ? 'Tidak ada pengajuan menunggu.' : 'Belum ada data.'}
        </div>
      ) : (
        <div className="space-y-2 pb-4">
          {items.map((it) => {
            const id = it.requestId ?? it.id ?? '';
            const name = it.employee?.displayName ?? it.employeeName ?? it.employee?.username ?? '?';
            const division = it.employee?.division ?? it.division;
            const link = chatLink(it);
            return (
              <div key={id} className="rounded-card border border-gray-200 bg-white p-3.5 text-[14px] text-ink">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{name}</div>
                    <div className="text-[13px] text-muted">
                      {division ?? '-'}
                      {it.employee?.username ? ` · @${it.employee.username}` : ''}
                    </div>
                  </div>
                  <Badge tone={statusTone(it.status)}>{it.statusLabel ?? it.status}</Badge>
                </div>
                <div className="mt-2 space-y-0.5">
                  <Row k="Jenis" v={it.typeLabel ?? it.type ?? ''} />
                  <Row k="Tanggal" v={it.dateLabel ?? ''} />
                  {it.reason ? <Row k="Alasan" v={it.reason} /> : null}
                  <Row k="Sumber" v={it.source === 'CHAT' ? 'Chat' : it.source === 'MANUAL' ? 'Manual' : (it.source ?? '-')} />
                </div>
                {it.erpSyncLabel ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
                    <span>Absensi:</span>
                    <Badge tone={statusTone(it.erpSync)}>{it.erpSyncLabel}</Badge>
                    {it.erpReference ? <span className="font-mono text-[12px]">{it.erpReference}</span> : null}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {it.status === 'PENDING_APPROVAL' && (
                    <>
                      <Button size="sm" variant="primary" onClick={() => decide(it, 'APPROVED')} loading={busy === id} disabled={busy !== null}>
                        Setujui
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => decide(it, 'REJECTED')} disabled={busy !== null}>
                        Tolak
                      </Button>
                    </>
                  )}
                  {link ? (
                    <Link href={link} className="ml-auto text-[13px] font-medium text-ink underline">
                      Buka chat
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-muted">{k}</span>
      <span className="break-words">{v}</span>
    </div>
  );
}
