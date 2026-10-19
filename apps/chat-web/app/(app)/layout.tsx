'use client';

import { usePathname } from 'next/navigation';
import { SessionProvider, useSession } from '@/components/Session';
import { TabBar } from '@/components/TabBar';
import { ConversationList } from '@/components/ConversationList';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { me, hrCount } = useSession();
  const inConv = path.startsWith('/c/');
  const isChatArea = path === '/' || inConv;

  if (!me) {
    return <div className="flex min-h-screen items-center justify-center text-[14px] text-muted">Memuat...</div>;
  }

  return (
    <div className="min-h-screen md:pl-[76px]">
      <TabBar hrCount={hrCount} />
      {isChatArea ? (
        <div className="flex h-[100dvh] md:h-screen">
          <aside className={`w-full border-r border-gray-200 bg-white md:block md:w-[360px] md:shrink-0 ${inConv ? 'hidden' : 'block'}`}>
            <ConversationList />
          </aside>
          <section className={`min-w-0 flex-1 ${inConv ? 'block' : 'hidden md:block'}`}>
            {inConv ? children : <div className="hidden h-full items-center justify-center text-[14px] text-muted md:flex">Pilih percakapan</div>}
          </section>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-2xl pb-20 md:pb-8">{children}</div>
      )}
    </div>
  );
}
