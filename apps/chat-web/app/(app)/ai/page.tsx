'use client';

import Link from 'next/link';
import { useSession } from '@/components/Session';
import { Avatar } from '@/components/ConversationList';
import { Spinner, VerifiedIcon } from '@/components/ui';

export default function AiPage() {
  const { me, conversations, convLoading } = useSession();
  const ai = conversations.filter((c) => c.type === 'AI');
  const notConnected = me?.aiStatus === 'BELUM_TERHUBUNG';

  return (
    <div className="px-4 pt-4">
      <h1 className="mb-3 text-[22px] font-semibold text-ink">AI</h1>
      {notConnected && (
        <div className="mb-3 rounded-field border border-yellow-200 bg-yellow-50 px-3 py-2 text-[13px] text-ink">AI belum terhubung</div>
      )}
      <div className="overflow-hidden rounded-card border border-gray-200 bg-white">
        {convLoading ? <Spinner /> : null}
        {!convLoading && ai.length === 0 ? <div className="p-4 text-[14px] text-muted">Asisten AI belum tersedia untuk akun ini.</div> : null}
        {ai.map((c) => (
          <Link key={c.id} href={`/c/${c.id}`} className="flex items-center gap-3 border-b border-gray-100 px-3 py-3 last:border-b-0 hover:bg-gray-50">
            <Avatar name={c.title} type="AI" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-[15px] font-medium text-ink">
                {c.title}
                <VerifiedIcon />
              </div>
              <div className="text-[13px] text-muted">{c.username === 'hr.ai' ? 'Tanya HR, pengajuan, status' : 'SOP, bantu tulis pesan, rangkuman'}</div>
            </div>
            {c.unread ? <span className="rounded-[6px] bg-lemone px-1.5 text-[11px] font-semibold text-ink">{c.unread}</span> : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
