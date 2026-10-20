'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useSession } from './Session';
import { get, post, errMsg } from '@/lib/api';
import type { Conversation, DirectoryUser } from '@/lib/types';
import { fmtListTime } from '@/lib/time';
import { Button, Input, Label, Modal, Spinner, VerifiedIcon, Empty } from './ui';
import { useToast } from './Toast';

export function ConversationList() {
  const { conversations, convLoading, reloadConversations, wsStatus } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [dir, setDir] = useState<DirectoryUser[]>([]);
  const [dirLoading, setDirLoading] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return conversations;
    return conversations.filter((c) => (c.title ?? '').toLowerCase().includes(s) || (c.username ?? '').toLowerCase().includes(s));
  }, [conversations, q]);

  useEffect(() => {
    const s = q.trim();
    if (!s) {
      setDir([]);
      return;
    }
    let alive = true;
    setDirLoading(true);
    const t = setTimeout(() => {
      get<DirectoryUser[] | { items: DirectoryUser[] }>(`/chat/directory?q=${encodeURIComponent(s)}`)
        .then((r) => {
          if (!alive) return;
          setDir(Array.isArray(r) ? r : (r.items ?? []));
        })
        .catch(() => alive && setDir([]))
        .finally(() => alive && setDirLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  async function openDm(u: DirectoryUser) {
    try {
      const r = await post<{ id: string } | Conversation>('/chat/conversations/dm', { userId: u.userId });
      setQ('');
      await reloadConversations();
      router.push(`/c/${r.id}`);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  // Hanya DM dan percakapan layanan yang menutup hasil direktori; kotak masuk HR milik karyawan (dilihat petugas) bukan DM.
  const existingUsernames = new Set(conversations.filter((c) => c.type === 'DM' || c.type === 'AI' || (c.type === 'HR_INBOX' && c.myRole !== 'OFFICER')).map((c) => c.username).filter(Boolean));
  const dirResults = dir.filter((u) => !existingUsernames.has(u.username));

  return (
    <div className="relative flex h-full flex-col">
      <header className="border-b border-gray-200 bg-white px-3 pb-2 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-[22px] font-semibold text-ink">Chat</h1>
          {wsStatus !== 'OPEN' && wsStatus !== 'REVOKED' ? (
            <span className="text-[12px] text-muted">{wsStatus === 'CONNECTING' ? 'Menghubungkan...' : 'Terputus'}</span>
          ) : null}
        </div>
        <Input placeholder="Cari percakapan atau rekan" value={q} onChange={(e) => setQ(e.target.value)} />
      </header>

      <div className="flex-1 overflow-y-auto pb-24">
        {convLoading ? (
          <Spinner />
        ) : (
          <>
            {filtered.length === 0 && !q ? (
              <Empty text="Belum ada percakapan" action={<Button onClick={() => setGroupOpen(true)}>Buat grup</Button>} />
            ) : null}
            {filtered.map((c) => (
              <ConversationRow key={c.id} c={c} active={pathname === `/c/${c.id}`} />
            ))}
            {q.trim() ? (
              <div className="mt-2">
                <div className="px-3 py-1 text-[12px] font-medium uppercase text-muted">Rekan kerja</div>
                {dirLoading && dirResults.length === 0 ? <Spinner /> : null}
                {!dirLoading && dirResults.length === 0 && filtered.length === 0 ? <Empty text="Tidak ditemukan" /> : null}
                {dirResults.map((u) => (
                  <button
                    key={u.userId}
                    onClick={() => openDm(u)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50"
                  >
                    <Avatar name={u.displayName} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 text-[15px] font-medium text-ink">
                        <span className="truncate">{u.displayName}</span>
                        {u.verified ? <VerifiedIcon /> : null}
                      </div>
                      <div className="truncate text-[13px] text-muted">
                        @{u.username}
                        {u.division ? ` · ${u.division}` : ''}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      <button
        onClick={() => setGroupOpen(true)}
        className="absolute bottom-20 right-4 flex h-12 items-center gap-2 rounded-panel bg-lemone px-4 text-[14px] font-semibold text-ink shadow-lg hover:bg-lemone-hover md:bottom-5"
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 4v12M4 10h12" strokeLinecap="round" />
        </svg>
        Grup baru
      </button>

      {groupOpen && <GroupModal onClose={() => setGroupOpen(false)} />}
    </div>
  );
}

function ConversationRow({ c, active }: { c: Conversation; active: boolean }) {
  return (
    <Link href={`/c/${c.id}`} className={`flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 ${active ? 'bg-yellow-50' : ''}`}>
      <Avatar name={c.title} type={c.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="truncate text-[15px] font-medium text-ink">{c.title}</span>
          {c.verified ? <VerifiedIcon /> : null}
          <span className="ml-auto shrink-0 text-[12px] text-muted">{fmtListTime(c.lastMessageAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] text-muted">{lastPreview(c)}</span>
          {c.unread ? (
            <span className="ml-auto shrink-0 rounded-[6px] bg-lemone px-1.5 text-[11px] font-semibold text-ink">{c.unread}</span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function lastPreview(c: Conversation): string {
  const lm = c.lastMessage;
  if (typeof lm === 'string') return lm;
  if (lm && typeof lm === 'object') {
    if (lm.kind === 'CARD') return lm.body ?? 'Kartu pengajuan';
    if (lm.kind === 'VOICE') return 'Pesan suara';
    if (lm.kind === 'FILE') return 'Lampiran';
    return lm.body ?? '';
  }
  return c.type === 'GROUP' ? `${c.memberCount ?? 0} anggota` : '';
}

export function Avatar({ name, type }: { name?: string | null; type?: string }) {
  const initials = (name ?? '?')
    .replace('@', '')
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
  const bg = type === 'HR_INBOX' || type === 'AI' ? 'bg-lemone' : type === 'GROUP' ? 'bg-gray-300' : 'bg-gray-200';
  return <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-card text-[14px] font-semibold text-ink ${bg}`}>{initials}</div>;
}

function GroupModal({ onClose }: { onClose: () => void }) {
  const { reloadConversations } = useSession();
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<DirectoryUser[]>([]);
  const [selected, setSelected] = useState<Map<string, DirectoryUser>>(new Map());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      get<DirectoryUser[] | { items: DirectoryUser[] }>(`/chat/directory?q=${encodeURIComponent(q.trim())}`)
        .then((r) => alive && setPeople((Array.isArray(r) ? r : (r.items ?? [])).filter((u) => !u.verified)))
        .catch(() => {});
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  function toggle(u: DirectoryUser) {
    setSelected((prev) => {
      const n = new Map(prev);
      if (n.has(u.userId)) n.delete(u.userId);
      else n.set(u.userId, u);
      return n;
    });
  }

  async function create() {
    if (!title.trim()) {
      toast('Nama grup wajib diisi', 'error');
      return;
    }
    if (selected.size === 0) {
      toast('Pilih minimal satu anggota', 'error');
      return;
    }
    setBusy(true);
    try {
      const r = await post<{ id: string }>('/chat/conversations/group', { title: title.trim(), memberIds: [...selected.keys()] });
      toast('Grup dibuat');
      await reloadConversations();
      onClose();
      router.push(`/c/${r.id}`);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Grup baru" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <Label>Nama grup</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div>
          <Label>Anggota</Label>
          {selected.size > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {[...selected.values()].map((u) => (
                <button key={u.userId} onClick={() => toggle(u)} className="rounded-[6px] bg-lemone px-2 py-0.5 text-[12px] text-ink">
                  {u.displayName} ×
                </button>
              ))}
            </div>
          )}
          <Input placeholder="Cari rekan" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="mt-2 max-h-56 overflow-y-auto rounded-field border border-gray-200">
            {people.length === 0 ? <div className="p-3 text-[13px] text-muted">Tidak ada hasil</div> : null}
            {people.map((u) => (
              <label key={u.userId} className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-gray-50">
                <input type="checkbox" checked={selected.has(u.userId)} onChange={() => toggle(u)} />
                <span className="text-[14px] text-ink">{u.displayName}</span>
                <span className="text-[12px] text-muted">@{u.username}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button variant="primary" onClick={create} loading={busy}>
            Buat grup
          </Button>
        </div>
      </div>
    </Modal>
  );
}
