'use client';

import type { Message, LeaveCardPayload, AskCardPayload } from '@/lib/types';
import { fmtTime } from '@/lib/time';
import { LeaveCard } from './LeaveCard';
import { Button } from './ui';

export function MessageBubble({
  msg,
  mine,
  showSender,
  onRetry,
  onQuickReply,
  onCardChanged,
}: {
  msg: Message;
  mine: boolean;
  showSender: boolean;
  onRetry?: (m: Message) => void;
  onQuickReply?: (text: string) => void;
  onCardChanged?: () => void;
}) {
  if (msg.kind === 'SYSTEM') {
    return (
      <div className="my-1 flex justify-center px-6">
        <div className="max-w-[85%] rounded-field bg-gray-100 px-3 py-1.5 text-center text-[13px] text-muted">{msg.body}</div>
      </div>
    );
  }

  const card = msg.kind === 'CARD' ? (msg.payload as { card?: string } | null) : null;
  const senderLine = msg.via_username
    ? `@${msg.via_username} · ${msg.sender_name ?? msg.sender_username ?? ''}`
    : showSender
      ? (msg.sender_name ?? msg.sender_username ?? '')
      : '';

  let content: React.ReactNode;
  if (card?.card === 'LEAVE_REQUEST') {
    content = <LeaveCard card={msg.payload as LeaveCardPayload} compact onChanged={onCardChanged} />;
  } else if (card?.card === 'ASK') {
    const p = msg.payload as AskCardPayload;
    content = (
      <div className="rounded-card border border-gray-200 bg-white p-3 text-[14px] text-ink">
        <div className="whitespace-pre-wrap">{msg.body}</div>
        {p.quickReplies && p.quickReplies.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.quickReplies.map((q) => (
              <Button key={q} size="sm" onClick={() => onQuickReply?.(q)}>
                {q}
              </Button>
            ))}
          </div>
        )}
      </div>
    );
  } else if (card?.card === 'HINT') {
    content = <div className="rounded-card bg-yellow-50 px-3 py-2 text-[13px] text-ink">{msg.body}</div>;
  } else {
    content = (
      <div
        className={`whitespace-pre-wrap break-words rounded-card px-3 py-2 text-[15px] ${
          mine ? 'bg-lemone text-ink' : 'bg-white text-ink border border-gray-200'
        }`}
      >
        {msg.forwarded ? <div className="mb-0.5 text-[12px] italic text-muted">Diteruskan</div> : null}
        {msg.body}
      </div>
    );
  }

  const isCard = card?.card === 'LEAVE_REQUEST' || card?.card === 'ASK';

  return (
    <div className={`my-1 flex px-3 ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`${isCard ? 'w-full max-w-[92%] md:max-w-[480px]' : 'max-w-[82%] md:max-w-[65%]'}`}>
        {senderLine ? <div className="mb-0.5 px-1 text-[12px] font-medium text-muted">{senderLine}</div> : null}
        {content}
        <div className={`mt-0.5 flex items-center gap-2 px-1 text-[11px] text-muted ${mine ? 'justify-end' : ''}`}>
          {msg.local === 'SENDING' ? (
            <span>Mengirim...</span>
          ) : msg.local === 'FAILED' ? (
            <>
              <span className="text-danger">Belum terkirim</span>
              <button className="font-medium text-ink underline" onClick={() => onRetry?.(msg)}>
                Kirim ulang
              </button>
            </>
          ) : (
            <span>{fmtTime(msg.created_at)}</span>
          )}
        </div>
      </div>
    </div>
  );
}
