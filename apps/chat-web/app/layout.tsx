import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/Toast';

export const metadata: Metadata = {
  title: 'Lemone Chat',
  description: 'Komunikasi internal Lemone',
  applicationName: 'Lemone Chat',
  manifest: '/manifest.webmanifest',
  icons: { icon: [{ url: '/favicon.ico' }, { url: '/brand/icon-32.png', sizes: '32x32' }, { url: '/brand/icon-192.png', sizes: '192x192' }], apple: '/brand/icon-180.png' },
  appleWebApp: { capable: true, title: 'Lemone Chat', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#FFCC00',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="font-sans">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
