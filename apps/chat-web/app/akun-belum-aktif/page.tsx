export default function PendingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f4] p-6">
      <div className="w-full max-w-sm rounded-panel border border-gray-200 bg-white p-6 text-center shadow-sm">
        <h1 className="mb-3 text-[22px] font-semibold text-ink">Lemone Chat</h1>
        <p className="text-[15px] text-ink">Akun belum diaktifkan. Buka tautan aktivasi dari HR.</p>
        <a href="/masuk" className="mt-5 inline-flex h-10 items-center rounded-field border border-gray-300 bg-white px-4 text-[14px] font-medium text-ink hover:bg-gray-50">
          Ke halaman masuk
        </a>
      </div>
    </main>
  );
}
