'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, isApiError, isManager, type Me } from '@/lib/api';
import { useToast } from './Toast';
import { Button, Spinner } from './ui';

type Status = { erp: { adapter: string; label: string; connected: boolean; status: string }; email: { status: string }; push: { status: string }; ai: { status: string } };

const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx)!;

export function useLogout() {
  const toast = useToast();
  return useCallback(
    async (all = false) => {
      try {
        if (all) await api.post('/auth/work/logout-all');
        const r = await api.post<{ redirect?: string }>('/auth/work/logout');
        window.location.href = r.redirect || `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/masuk`;
      } catch (e) {
        toast(isApiError(e) ? e.message : 'Gagal keluar.', 'danger');
        if (isApiError(e) && e.status === 401) window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/masuk`;
      }
    },
    [toast],
  );
}

export function RequireSession({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'noaccess' | 'error'>('loading');
  const router = useRouter();
  const pathname = usePathname();
  const logout = useLogout();

  useEffect(() => {
    let alive = true;
    api
      .get<Me>('/auth/work/me')
      .then((m) => {
        if (!alive) return;
        if (m.status !== 'ACTIVE') return router.replace('/akun-belum-aktif');
        if (!m.canUseApp || !isManager(m)) {
          setMe(m);
          return setState('noaccess');
        }
        setMe(m);
        setState('ok');
      })
      .catch((e) => {
        if (!alive) return;
        if (isApiError(e) && e.status === 401) router.replace('/masuk');
        else if (isApiError(e) && (e.code === 'ACCOUNT_PENDING' || e.code === 'ACCOUNT_DISABLED')) router.replace('/akun-belum-aktif');
        else if (isApiError(e) && e.code === 'NO_APP_GRANT') setState('noaccess');
        else setState('error');
      });
    return () => {
      alive = false;
    };
  }, [router, pathname]);

  if (state === 'loading') return <Spinner />;
  if (state === 'error')
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="text-danger">Tidak bisa memeriksa sesi.</p>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          Muat ulang
        </Button>
      </div>
    );
  if (state === 'noaccess')
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="text-[17px] text-ink">Akun Anda tidak punya akses Lemone Work</p>
        <Button className="mt-4" onClick={() => logout()}>
          Keluar
        </Button>
      </div>
    );
  return <MeCtx.Provider value={me}>{children}</MeCtx.Provider>;
}

function connLabel(s: { status: string } | undefined) {
  return s?.status === 'TERHUBUNG' ? 'Terhubung' : 'Belum terhubung';
}

export function TopBar() {
  const me = useMe();
  const logout = useLogout();
  const [st, setSt] = useState<Status | null>(null);
  useEffect(() => {
    api.get<Status>('/work/status').then(setSt).catch(() => setSt(null));
  }, []);
  const erpLabel = st ? `${st.erp.label || (st.erp.connected ? 'ERP' : 'DEMO')} · ${st.erp.connected ? 'Terhubung' : 'Belum terhubung'}` : null;
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
        <Link href="/user" className="text-[20px] font-bold text-ink">
          Lemone Work
        </Link>
        <div className="flex items-center gap-3 text-[15px]">
          <span className="text-ink">{me.displayName}</span>
          <Button className="!px-3 !py-1 text-[13px]" onClick={() => logout()}>
            Keluar
          </Button>
        </div>
      </div>
      <div className="border-t border-gray-100 bg-gray-50">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 py-1.5 text-[13px] text-muted">
          <span>{erpLabel ?? 'ERP · memeriksa...'}</span>
          <span>Email · {connLabel(st?.email)}</span>
          <span>Push · {connLabel(st?.push)}</span>
          <span>AI · {connLabel(st?.ai)}</span>
        </div>
      </div>
    </header>
  );
}
