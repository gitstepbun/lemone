import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { login, type Tokens } from '../lib/auth';
import { api, ApiError } from '../lib/api';

export function LoginScreen({ onLoggedIn }: { onLoggedIn: (t: Tokens) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (switchAccount = false) => {
    setBusy(true); setError(null);
    try {
      const t = await login({ switchAccount });
      // Hak masuk aplikasi diperiksa setelah autentikasi berhasil.
      await api('/chat/me');
      onLoggedIn(t);
    } catch (e) {
      if (e instanceof ApiError) setError(e.code === 'ACCOUNT_PENDING' ? 'Akun belum diaktifkan. Buka tautan aktivasi dari HR.' : e.code === 'ACCOUNT_DISABLED' ? 'Akun dinonaktifkan. Hubungi HR.' : e.code === 'NO_APP_GRANT' ? 'Akun tidak punya akses Chat.' : e.message);
      else setError((e as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' }}>
      <Text style={{ fontSize: 28, fontWeight: '700', marginBottom: 24 }}>Lemone Chat</Text>
      <Pressable disabled={busy} onPress={() => go(false)} style={{ backgroundColor: '#FFCC00', borderRadius: 10, padding: 14, alignItems: 'center' }}>
        <Text style={{ fontWeight: '600', color: '#1A1A1A' }}>Masuk dengan akun Lemone</Text>
      </Pressable>
      <Pressable disabled={busy} onPress={() => go(true)} style={{ marginTop: 12, alignItems: 'center' }}>
        <Text style={{ color: '#6B7280' }}>Masuk dengan akun lain</Text>
      </Pressable>
      {error ? <Text style={{ color: '#B3261E', marginTop: 16 }}>{error}</Text> : null}
    </View>
  );
}
