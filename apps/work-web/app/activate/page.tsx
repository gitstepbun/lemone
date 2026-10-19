import type { Metadata } from 'next';
import { ActivateClient } from './ActivateClient';

export const metadata: Metadata = { title: 'Aktivasi akun Lemone', referrer: 'no-referrer', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function ActivatePage() {
  return (
    <>
      <meta name="referrer" content="no-referrer" />
      <ActivateClient chatUrl={process.env.NEXT_PUBLIC_CHAT_URL ?? 'http://localhost:3002'} />
    </>
  );
}
