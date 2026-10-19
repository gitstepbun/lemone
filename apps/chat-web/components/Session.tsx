'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { get, post } from '@/lib/api';
import { chatSocket, type WsEvent, type WsStatus } from '@/lib/ws';
import type { Conversation, Me, Message } from '@/lib/types';
import { useToast } from './Toast';

interface SessionCtx {
  me: Me | null;
  conversations: Conversation[];
  convLoading: boolean;
  reloadConversations: () => Promise<void>;
  onWs: (fn: (ev: WsEvent) => void) => () => void;
  wsStatus: WsStatus;
  hrCount: number;
  setHrCount: (n: number) => void;
  hrQueueTick: number;
}

const Ctx = createContext<SessionCtx | null>(null);

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession di luar SessionProvider');
  return c;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const meRef = useRef<Me | null>(null);
  meRef.current = me;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [wsStatus, setWsStatus] = useState<WsStatus>('CLOSED');
  const [hrCount, setHrCount] = useState(0);
  const [hrQueueTick, setHrQueueTick] = useState(0);
  const [revoked, setRevoked] = useState(false);
  const deviceDone = useRef(false);
  const openConv = useRef<string | null>(null);

  const goLogin = useCallback(() => {
    router.replace('/masuk');
  }, [router]);

  const reloadConversations = useCallback(async () => {
    try {
      const r = await get<Conversation[] | { items: Conversation[] }>('/chat/conversations');
      setConversations(Array.isArray(r) ? r : (r.items ?? []));
    } catch (e) {
      const st = (e as { status?: number }).status;
      if (st === 401) goLogin();
    } finally {
      setConvLoading(false);
    }
  }, [goLogin]);

  // Session check + profile
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const auth = await get<{ status?: string; canUseApp?: boolean }>('/auth/chat/me');
        if (!alive) return;
        if (auth.status && auth.status !== 'ACTIVE') {
          router.replace(auth.status === 'PENDING' || auth.status === 'PENDING_ACTIVATION' ? '/akun-belum-aktif' : '/masuk?error=nonaktif');
          return;
        }
        const m = await get<Me>('/chat/me');
        if (!alive) return;
        setMe(m);
        void reloadConversations();
        if (!deviceDone.current) {
          deviceDone.current = true;
          post('/chat/devices', { platform: 'WEB', label: navigator.userAgent.slice(0, 60) }).catch(() => {});
        }
        if (m.isHr || m.isApprover) {
          get<unknown>('/hr/queue?status=PENDING_APPROVAL')
            .then((r) => setHrCount(countOf(r)))
            .catch(() => {});
        }
      } catch (e) {
        const st = (e as { status?: number; code?: string }).status;
        const code = (e as { code?: string }).code;
        if (st === 401) goLogin();
        else if (code === 'ACCOUNT_PENDING') router.replace('/akun-belum-aktif');
        else if (code === 'ACCOUNT_DISABLED') router.replace('/masuk?error=nonaktif');
        else if (code === 'NO_APP_GRANT') router.replace('/masuk?error=tanpa_akses');
        else toast('Tidak bisa memuat sesi. Coba muat ulang.', 'error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [router, goLogin, reloadConversations, toast]);

  // WebSocket lifecycle
  useEffect(() => {
    if (!me) return;
    chatSocket.start();
    const offStatus = chatSocket.onStatus(setWsStatus);
    const off = chatSocket.on((ev) => {
      if (ev.event === 'revoked') {
        setRevoked(true);
        return;
      }
      if (ev.event === 'ready') {
        void reloadConversations();
        return;
      }
      if (ev.event === 'message') {
        const m = ev.data as Message | undefined;
        const cid = ev.conversationId ?? m?.conversation_id;
        if (!cid) return;
        setConversations((prev) => {
          const idx = prev.findIndex((c) => c.id === cid);
          if (idx < 0) {
            void reloadConversations();
            return prev;
          }
          const c = prev[idx];
          const mine = m?.sender_user_id === me.userId;
          const updated: Conversation = {
            ...c,
            lastMessage: { kind: m?.kind, body: previewOf(m), senderUserId: m?.sender_user_id ?? null, at: m?.created_at },
            lastMessageAt: m?.created_at ?? new Date().toISOString(),
            unread: mine || openConv.current === cid ? c.unread ?? 0 : (c.unread ?? 0) + 1,
          };
          const rest = prev.filter((_, i) => i !== idx);
          return [updated, ...rest];
        });
      }
      if (ev.event === 'hr.queue') {
        const d = ev.data as { pending?: number; count?: number } | undefined;
        if (d && typeof (d.pending ?? d.count) === 'number') setHrCount((d.pending ?? d.count) as number);
        else if (meRef.current?.isHr || meRef.current?.isApprover)
          get<unknown>('/hr/queue?status=PENDING_APPROVAL')
            .then((r) => setHrCount(countOf(r)))
            .catch(() => {});
        setHrQueueTick((t) => t + 1);
      }
    });
    return () => {
      off();
      offStatus();
      chatSocket.stop();
    };
  }, [me, reloadConversations]);

  // Revoked: logout then go to login
  useEffect(() => {
    if (!revoked) return;
    post('/auth/chat/logout')
      .catch(() => {})
      .finally(() => {
        window.location.href = '/masuk?error=akses_dicabut';
      });
  }, [revoked]);

  const onWs = useCallback((fn: (ev: WsEvent) => void) => chatSocket.on(fn), []);

  const value = useMemo<SessionCtx>(
    () => ({ me, conversations, convLoading, reloadConversations, onWs, wsStatus, hrCount, setHrCount, hrQueueTick }),
    [me, conversations, convLoading, reloadConversations, onWs, wsStatus, hrCount, hrQueueTick],
  );

  if (revoked) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center text-[16px] text-ink">
        Akses dicabut. Mengalihkan ke halaman masuk...
      </div>
    );
  }

  return (
    <Ctx.Provider value={value}>
      <OpenConvTracker refObj={openConv} />
      {children}
    </Ctx.Provider>
  );
}

/** Tracks the currently open conversation id so incoming messages there are not counted as unread. */
function OpenConvTracker({ refObj }: { refObj: React.MutableRefObject<string | null> }) {
  const pathname = usePathnameSafe();
  useEffect(() => {
    const m = pathname.match(/^\/c\/([^/]+)/);
    refObj.current = m ? decodeURIComponent(m[1]) : null;
  }, [pathname, refObj]);
  return null;
}

function usePathnameSafe() {
  return usePathname() ?? '';
}

function countOf(r: unknown): number {
  if (Array.isArray(r)) return r.length;
  if (r && typeof r === 'object') {
    const o = r as { items?: unknown[]; total?: number; count?: number };
    if (typeof o.total === 'number') return o.total;
    if (typeof o.count === 'number') return o.count;
    if (Array.isArray(o.items)) return o.items.length;
  }
  return 0;
}

export function previewOf(m?: Message | null): string {
  if (!m) return '';
  if (m.kind === 'CARD') {
    const p = m.payload as { card?: string; typeLabel?: string } | null;
    if (p?.card === 'LEAVE_REQUEST') return `Pengajuan: ${p.typeLabel ?? ''}`.trim();
    return m.body ?? 'Kartu';
  }
  if (m.kind === 'VOICE') return 'Pesan suara';
  if (m.kind === 'FILE') return 'Lampiran';
  return m.body ?? '';
}
