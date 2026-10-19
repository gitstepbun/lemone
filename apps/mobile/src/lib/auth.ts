/**
 * Login OIDC Authorization Code + PKCE S256 lewat browser autentikasi sistem (expo-auth-session).
 * Public client tanpa secret. Token disimpan di SecureStore. Belum diuji di perangkat: lihat docs/laporan.md.
 */
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

const extra = (Constants.expoConfig?.extra ?? {}) as { oidcIssuer: string; apiUrl: string; wsUrl: string; androidClientId: string; iosClientId: string };
export const API_URL = extra.apiUrl;
export const WS_URL = extra.wsUrl;
const KEY = 'lemone.tokens';

export interface Tokens { accessToken: string; refreshToken?: string; idToken?: string; expiresAt: number }

export function clientId(): string {
  return Platform.OS === 'ios' ? extra.iosClientId : extra.androidClientId;
}

export const redirectUri = AuthSession.makeRedirectUri({ scheme: 'lemone.chat', path: 'oauth/callback' });

export async function discovery() {
  return AuthSession.fetchDiscoveryAsync(extra.oidcIssuer);
}

export async function loadTokens(): Promise<Tokens | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as Tokens) : null;
}

export async function saveTokens(t: Tokens | null) {
  if (!t) await SecureStore.deleteItemAsync(KEY);
  else await SecureStore.setItemAsync(KEY, JSON.stringify(t));
}

/** Buka login. `prompt=login` memaksa autentikasi ulang (pergantian akun). */
export async function login(opts: { switchAccount?: boolean } = {}): Promise<Tokens> {
  const disc = await discovery();
  const req = new AuthSession.AuthRequest({
    clientId: clientId(),
    redirectUri,
    scopes: ['openid', 'profile'],
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    codeChallengeMethod: AuthSession.CodeChallengeMethod.S256,
    extraParams: { ui_locales: 'id', ...(opts.switchAccount ? { prompt: 'login' } : {}) },
  });
  const res = await req.promptAsync(disc);
  if (res.type !== 'success') throw new Error(res.type === 'cancel' || res.type === 'dismiss' ? 'Login dibatalkan' : 'Login gagal');
  if (res.params.state !== req.state) throw new Error('State tidak cocok');
  const tok = await AuthSession.exchangeCodeAsync(
    { clientId: clientId(), code: res.params.code, redirectUri, extraParams: { code_verifier: req.codeVerifier! } },
    disc,
  );
  const t: Tokens = { accessToken: tok.accessToken, refreshToken: tok.refreshToken, idToken: tok.idToken, expiresAt: Date.now() + (tok.expiresIn ?? 300) * 1000 };
  await saveTokens(t);
  return t;
}

export async function refresh(t: Tokens): Promise<Tokens | null> {
  if (!t.refreshToken) return null;
  try {
    const disc = await discovery();
    const tok = await AuthSession.refreshAsync({ clientId: clientId(), refreshToken: t.refreshToken }, disc);
    const n: Tokens = { accessToken: tok.accessToken, refreshToken: tok.refreshToken ?? t.refreshToken, idToken: tok.idToken ?? t.idToken, expiresAt: Date.now() + (tok.expiresIn ?? 300) * 1000 };
    await saveTokens(n);
    return n;
  } catch {
    await saveTokens(null);
    return null;
  }
}

export async function logout(t: Tokens | null) {
  await saveTokens(null);
  if (!t?.idToken) return;
  const disc = await discovery();
  if (disc.endSessionEndpoint) {
    const url = `${disc.endSessionEndpoint}?id_token_hint=${encodeURIComponent(t.idToken)}&post_logout_redirect_uri=${encodeURIComponent(AuthSession.makeRedirectUri({ scheme: 'lemone.chat', path: 'oauth/logout' }))}`;
    await WebBrowser.openAuthSessionAsync(url, redirectUri).catch(() => undefined);
  }
}
