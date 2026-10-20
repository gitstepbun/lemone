'use client';

import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/ui';
import { api, errorMessage, isApiError, type Me, roleNames } from '@/lib/api';
import { fmtDate } from '@/lib/format';

type Inspect = { status: 'VALID' | 'EXPIRED' | 'REVOKED' | 'USED' | 'INVALID' | 'IN_PROGRESS'; username?: string; displayName?: string; expiresAt?: string; resumable?: boolean };

const STATUS_TEXT: Record<string, string> = {
  IN_PROGRESS: 'Aktivasi sedang berjalan di perangkat lain',
  USED: 'Undangan sudah dipakai',
  EXPIRED: 'Undangan kedaluwarsa, minta HR membuat ulang',
  REVOKED: 'Undangan dibatalkan',
  INVALID: 'Tautan aktivasi tidak dikenali',
};

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-panel border border-gray-200 bg-white p-6">
        <div className="mb-1 text-center text-[13px] font-semibold text-muted">Lemone</div>
        <h1 className="mb-4 text-center">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function ActivateClient({ chatUrl }: { chatUrl: string }) {
  const toast = useToast();
  const token = useRef<string | null>(null);
  const [mode, setMode] = useState<'loading' | 'inspect' | 'done' | 'mismatch' | 'expired' | 'revoked' | 'invalid' | 'notoken'>('loading');
  const [as, setAs] = useState('');
  const [info, setInfo] = useState<Inspect | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasWork, setHasWork] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const t = url.searchParams.get('t');
    const status = url.searchParams.get('status');
    if (t) {
      token.current = t;
      url.searchParams.delete('t');
      window.history.replaceState(null, '', url.pathname + (url.search || ''));
    }
    if (status === 'done') {
      setMode('done');
      api
        .get<Me>('/auth/work/me')
        .then((m) => setHasWork(m.canUseApp && roleNames(m).some((r) => ['OWNER', 'ACCOUNT_ADMIN', 'HR'].includes(r))))
        .catch(() => {});
      return;
    }
    if (status === 'mismatch') {
      setAs(url.searchParams.get('as') ?? '');
      return setMode('mismatch');
    }
    if (status === 'expired' || status === 'revoked' || status === 'invalid') return setMode(status);
    if (!t) return setMode('notoken');
    api
      .post<Inspect>('/activation/inspect', { token: t })
      .then((r) => {
        setInfo(r);
        setMode('inspect');
      })
      .catch(() => {
        setInfo({ status: 'INVALID' });
        setMode('inspect');
      });
  }, []);

  async function begin() {
    if (!token.current) return;
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; loginUrl: string }>('/activation/begin', { token: token.current });
      window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}${r.loginUrl}`;
    } catch (e) {
      setBusy(false);
      // 409 body is { ok:false, status } ; the helper maps that `status` string into `code`.
      if (isApiError(e) && e.status === 409) setInfo({ status: (STATUS_TEXT[e.code] ? e.code : 'INVALID') as Inspect['status'] });
      else toast(errorMessage(e), 'danger');
    }
  }

  async function switchAccount() {
    setBusy(true);
    try {
      const c = await api.get<{ active: boolean; loginUrl?: string }>('/activation/context');
      if (c.active && c.loginUrl) window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}${c.loginUrl}`;
      else {
        setBusy(false);
        toast('Konteks aktivasi tidak ditemukan. Buka lagi tautan aktivasi.', 'danger');
      }
    } catch (e) {
      setBusy(false);
      toast(errorMessage(e), 'danger');
    }
  }

  if (mode === 'loading') return <Shell title="Aktivasi akun Lemone"><p className="text-center text-muted">Memeriksa undangan...</p></Shell>;

  if (mode === 'done')
    return (
      <Shell title="Akun aktif">
        <a href={chatUrl} className="block w-full rounded-field bg-lemone px-4 py-3 text-center font-medium text-ink hover:bg-lemone-hover">
          Buka Lemone Chat
        </a>
        {hasWork && (
          <a href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/user`} className="mt-3 block text-center text-[15px] text-ink underline">
            Buka Lemone Work
          </a>
        )}
      </Shell>
    );

  if (mode === 'mismatch')
    return (
      <Shell title="Akun tidak cocok">
        <p className="text-center">
          Browser ini sedang masuk sebagai <span className="font-mono font-semibold">{as || 'akun lain'}</span>. Keluar dulu, lalu buka lagi tautan aktivasi.
        </p>
        <Button variant="primary" full className="mt-5" busy={busy} onClick={switchAccount}>
          Ganti akun
        </Button>
      </Shell>
    );

  if (mode === 'expired') return <Shell title="Undangan kedaluwarsa"><p className="text-center">Minta HR membuat ulang undangan.</p></Shell>;
  if (mode === 'revoked') return <Shell title="Undangan dibatalkan"><p className="text-center">Hubungi HR untuk undangan baru.</p></Shell>;
  if (mode === 'invalid' || mode === 'notoken') return <Shell title="Tautan tidak dikenali"><p className="text-center">Buka tautan aktivasi persis seperti yang diberikan HR.</p></Shell>;

  const st = info?.status ?? 'INVALID';
  if (st !== 'VALID')
    return (
      <Shell title="Aktivasi akun Lemone">
        <p className="text-center text-danger">{STATUS_TEXT[st] ?? STATUS_TEXT.INVALID}</p>
      </Shell>
    );

  return (
    <Shell title="Aktivasi akun Lemone">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
        <dt className="text-muted">Nama</dt>
        <dd>{info?.displayName ?? '-'}</dd>
        <dt className="text-muted">Username</dt>
        <dd className="font-mono">{info?.username ?? '-'}</dd>
        <dt className="text-muted">Berlaku sampai</dt>
        <dd>{fmtDate(info?.expiresAt)}</dd>
      </dl>
      <Button variant="primary" full className="mt-5 !py-3" busy={busy} onClick={begin}>
        Aktifkan akun
      </Button>
    </Shell>
  );
}
