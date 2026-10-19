'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from './Session';

const icons = {
  chat: (
    <path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2H8l-4 3v-3H5a2 2 0 01-2-2V5z" />
  ),
  ai: <path d="M10 2l1.8 4.7L16.5 8.5l-4.7 1.8L10 15l-1.8-4.7L3.5 8.5l4.7-1.8L10 2zM16 13l.8 2.2L19 16l-2.2.8L16 19l-.8-2.2L13 16l2.2-.8L16 13z" />,
  me: <path d="M10 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM3 17a7 7 0 0114 0v1H3v-1z" />,
  hr: <path d="M4 3h12v14H4V3zm3 3h6M7 9h6M7 12h4" strokeWidth="1.6" stroke="currentColor" fill="none" strokeLinecap="round" />,
};

export function TabBar({ hrCount }: { hrCount?: number }) {
  const path = usePathname();
  const { me } = useSession();
  const showHr = !!me && (me.isHr || me.isApprover);
  const tabs: Array<{ href: string; label: string; icon: keyof typeof icons; active: boolean; badge?: number }> = [
    { href: '/', label: 'Chat', icon: 'chat', active: path === '/' || path.startsWith('/c/') },
    { href: '/ai', label: 'AI', icon: 'ai', active: path.startsWith('/ai') },
    { href: '/saya', label: 'Saya', icon: 'me', active: path.startsWith('/saya') },
  ];
  if (showHr) tabs.push({ href: '/hr', label: 'HR', icon: 'hr', active: path.startsWith('/hr'), badge: hrCount });

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-gray-200 bg-white md:inset-y-0 md:left-0 md:right-auto md:w-[76px] md:flex-col md:border-r md:border-t-0 md:pt-3">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] md:flex-none md:py-3 ${
            t.active ? 'text-ink font-semibold' : 'text-muted'
          }`}
        >
          <span className={`rounded-field px-3 py-0.5 ${t.active ? 'bg-lemone' : ''}`}>
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
              {icons[t.icon]}
            </svg>
          </span>
          {t.label}
          {t.badge ? (
            <span className="absolute right-[18%] top-1 min-w-[18px] rounded-[6px] bg-danger px-1 text-center text-[10px] font-semibold text-white md:right-2">
              {t.badge > 99 ? '99+' : t.badge}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
