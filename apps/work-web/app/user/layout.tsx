'use client';

import type { ReactNode } from 'react';
import { RequireSession, TopBar } from '@/components/Session';

export default function UserLayout({ children }: { children: ReactNode }) {
  return (
    <RequireSession>
      <TopBar />
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </RequireSession>
  );
}
