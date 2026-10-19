'use client';

import { use, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/components/Session';
import { get, post, errMsg } from '@/lib/api';
import type { Conversation, Message, SendResult } from '@/lib/types';
import { dayLabel, sameDay } from '@/lib/time';
import { MessageBubble } from '@/components/MessageBubble';
import { Composer } from '@/components/Composer';
import { VerifiedIcon } from '@/components/ui';
import { useToast } from '@/components/Toast';

interface Detail extends Omit<Conversation, 'title'> {
  title?: string | null;
  members?: Array<{ id: string; username: string; display_name: string; role: string }>;
}

const PAGE = 40;

export default function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me, conversations, onWs, reloadConversations } = useSession();
  const { toast } = useToast();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);
  const prevHeight = useRef(0);
  const outbox = useRef(new Map<string, { clientMsgId: string; body: string }>());
  const lastReadSeq = useRef(0);

  const fromList = conversations.find((c) => c.id === id);
  const conv: Conversation | null = fromList ? { ...fromList, myRole: fromList.myRole ?? detail?.myRole } : detail ? { ...detail, title: detail.title ?? 'Percakapan' } : null;

  const normalize = (r: Message[] | { items: Message[] }) => (Array.isArray(r) ? r : (r.items ?? []));

  // Initial load
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setMessages([]);
    setHasMore(true);
    stickBottom.current = true;
    get<Detail>(`/chat/conversations/${id}`)
      .then((d) => alive && setDetail(d))
      .catch(() => {});
    get<Message[] | { items: Message[] }>(`/chat/conversations/${id}/messages?limit=${PAGE}`)
      .then((r) => {
        if (!alive) return;
        const items = normalize(r).sort((a, b) => a.seq - b.seq);
        setMessages(items);
        setHasMore(items.length >= PAGE);
      })
      .catch((e) => toast(errMsg(e), 'error'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, toast]);

  // WS events for this conversation
  useEffect(() => {
    return onWs((ev) => {
      if (ev.event === 'message') {
        const m = ev.data as Message;
        if (!m || (ev.conversationId ?? m.conversation_id) !== id) return;
        setMessages((prev) => upsert(prev, m));
      }
      if (ev.event === 'message.updated') {
        const m = ev.data as Message;
        if (!m || (ev.conversationId ?? m.conversation_id) !== id) return;
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...m } : x)));
      }
    });
  }, [id, onWs]);

  // Mark read when newest seq changes
  useEffect(() => {
    const last = messages.filter((m) => !m.local).at(-1);
    if (!last || last.seq <= lastReadSeq.current) return;
    lastReadSeq.current = last.seq;
    post(`/chat/conversations/${id}/read`, { seq: last.seq })
      .then(() => reloadConversations())
      .catch(() => {});
  }, [messages, id, reloadConversations]);

  // Scroll handling
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (stickBottom.current) el.scrollTop = el.scrollHeight;
    else if (prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = 0;
    }
  }, [messages]);

  const loadOlder = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    const el = listRef.current;
    prevHeight.current = el?.scrollHeight ?? 0;
    stickBottom.current = false;
    try {
      const oldest = messages.find((m) => !m.local)?.seq;
      const r = await get<Message[] | { items: Message[] }>(`/chat/conversations/${id}/messages?before=${oldest}&limit=${PAGE}`);
      const items = normalize(r).sort((a, b) => a.seq - b.seq);
      setHasMore(items.length >= PAGE);
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        return [...items.filter((m) => !ids.has(m.id)), ...prev];
      });
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, messages, id, toast]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 40) void loadOlder();
  }

  const isHrInbox = conv?.type === 'HR_INBOX';
  const officerInInbox = !!me && isHrInbox && (conv?.myRole === 'OFFICER' || fromList?.myRole === 'OFFICER');

  async function send(body: string, existingId?: string) {
    if (!me) return;
    const clientMsgId = existingId ?? crypto.randomUUID();
    outbox.current.set(clientMsgId, { clientMsgId, body });
    stickBottom.current = true;
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.client_msg_id === clientMsgId);
      const local: Message = {
        id: `local-${clientMsgId}`,
        conversation_id: id,
        seq: Number.MAX_SAFE_INTEGER,
        sender_user_id: me.userId,
        sender_username: me.username,
        sender_name: me.displayName,
        client_msg_id: clientMsgId,
        kind: 'TEXT',
        body,
        created_at: new Date().toISOString(),
        local: 'SENDING',
      };
      if (idx >= 0) return prev.map((m, i) => (i === idx ? { ...m, local: 'SENDING' } : m));
      return [...prev, local];
    });
    try {
      const r = await post<SendResult>(`/chat/conversations/${id}/messages`, {
        clientMsgId,
        kind: 'TEXT',
        body,
        ...(officerInInbox ? { asService: true } : {}),
      });
      outbox.current.delete(clientMsgId);
      const m = r.message ?? (r as unknown as Message);
      if (m && (m as Message).id) {
        setMessages((prev) => upsert(prev.filter((x) => x.client_msg_id !== clientMsgId || !x.local), m as Message));
      } else {
        setMessages((prev) => prev.filter((x) => x.client_msg_id !== clientMsgId));
      }
    } catch (e) {
      setMessages((prev) => prev.map((m) => (m.client_msg_id === clientMsgId && m.local ? { ...m, local: 'FAILED' } : m)));
      toast(errMsg(e, 'Pesan belum terkirim'), 'error');
    }
  }

  function retry(m: Message) {
    if (m.client_msg_id && m.body) void send(m.body, m.client_msg_id);
  }

  const title = conv?.title ?? 'Percakapan';
  const subtitle =
    conv?.type === 'GROUP'
      ? `${conv.memberCount ?? detail?.members?.length ?? 0} anggota`
      : isHrInbox
        ? 'Layanan HR resmi'
        : conv?.type === 'AI'
          ? 'Asisten AI'
          : conv?.username
            ? `@${conv.username}`
            : '';

  return (
    <div className="flex h-[100dvh] flex-col bg-[#f5f5f4] md:h-screen">
      <header className="flex items-center gap-2 border-b border-gray-200 bg-white px-2 py-2">
        <Link href="/" className="rounded-field p-2 hover:bg-gray-100 md:hidden" aria-label="Kembali">
          <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 4l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[16px] font-semibold text-ink">
            <span className="truncate">{title}</span>
            {conv?.verified || isHrInbox ? <VerifiedIcon /> : null}
            {isHrInbox && !String(title).startsWith('@') ? <span className="text-[13px] font-normal text-muted">@hr</span> : null}
          </div>
          {subtitle ? <div className="truncate text-[12px] text-muted">{subtitle}</div> : null}
        </div>
      </header>

      {officerInInbox && (
        <div className="border-b border-yellow-200 bg-yellow-50 px-3 py-1.5 text-center text-[13px] text-ink">Anda membalas sebagai @hr</div>
      )}

      <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="py-8 text-center text-[14px] text-muted">Memuat...</div>
        ) : messages.length === 0 ? (
          <div className="py-8 text-center text-[14px] text-muted">
            {isHrInbox ? 'Tulis izin Anda, contoh: "Besok izin sakit".' : 'Belum ada pesan. Mulai percakapan.'}
          </div>
        ) : null}
        {loadingMore ? <div className="py-2 text-center text-[12px] text-muted">Memuat pesan lama...</div> : null}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const showDay = !prev || !sameDay(prev.created_at, m.created_at);
          const mine = m.sender_user_id === me?.userId && !m.via_username;
          const showSender = conv?.type === 'GROUP' && !mine && m.kind !== 'SYSTEM' && (!prev || prev.sender_user_id !== m.sender_user_id);
          return (
            <div key={m.id}>
              {showDay && !m.local ? (
                <div className="my-2 flex justify-center">
                  <span className="rounded-[6px] bg-gray-200 px-2 py-0.5 text-[11px] text-muted">{dayLabel(m.created_at)}</span>
                </div>
              ) : null}
              <MessageBubble
                msg={m}
                mine={mine}
                showSender={showSender}
                onRetry={retry}
                onQuickReply={(t) => void send(t)}
                onCardChanged={() => {
                  /* server pushes message.updated */
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="pb-14 md:pb-0">
        <Composer onSend={(t) => void send(t)} disabled={!conv} />
      </div>
    </div>
  );
}

function upsert(prev: Message[], m: Message): Message[] {
  const byId = prev.findIndex((x) => x.id === m.id);
  if (byId >= 0) return prev.map((x, i) => (i === byId ? { ...x, ...m, local: undefined } : x));
  const byClient = m.client_msg_id ? prev.findIndex((x) => x.client_msg_id === m.client_msg_id) : -1;
  if (byClient >= 0) return prev.map((x, i) => (i === byClient ? { ...m } : x));
  const next = [...prev, m];
  next.sort((a, b) => (a.local ? 1 : b.local ? -1 : a.seq - b.seq));
  return next;
}
