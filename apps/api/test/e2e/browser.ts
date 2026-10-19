/** Browser headless sederhana: cookie jar + redirect manual, cukup untuk mengemudikan form Keycloak dan BFF. */
import { createHmac } from 'node:crypto';

interface Cookie { name: string; value: string; domain: string; path: string }

export class Browser {
  private jar: Cookie[] = [];
  constructor(public readonly label: string) {}

  private cookiesFor(url: URL): string {
    return this.jar
      .filter((c) => c.domain === url.hostname && url.pathname.startsWith(c.path))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  private store(url: URL, setCookies: string[]) {
    for (const sc of setCookies) {
      const [pair, ...attrs] = sc.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq); const value = pair.slice(eq + 1);
      let path = '/';
      let expired = false;
      for (const a of attrs) {
        const [k, v] = a.split('=');
        if (k.toLowerCase() === 'path' && v) path = v;
        if (k.toLowerCase() === 'max-age' && Number(v) <= 0) expired = true;
        if (k.toLowerCase() === 'expires' && v && new Date(v).getTime() < Date.now()) expired = true;
      }
      this.jar = this.jar.filter((c) => !(c.name === name && c.domain === url.hostname && c.path === path));
      if (!expired) this.jar.push({ name, value, domain: url.hostname, path });
    }
  }

  cookie(name: string, host = 'localhost'): string | undefined {
    return this.jar.find((c) => c.name === name && c.domain === host)?.value;
  }

  clearCookie(name: string) {
    this.jar = this.jar.filter((c) => c.name !== name);
  }

  async fetch(url: string, init: RequestInit & { form?: Record<string, string>; json?: unknown } = {}): Promise<{ status: number; location: string | null; text: string; json: () => unknown; headers: Headers }> {
    const u = new URL(url);
    const headers = new Headers(init.headers ?? {});
    const cookie = this.cookiesFor(u);
    if (cookie) headers.set('cookie', cookie);
    let body: string | undefined = init.body as string | undefined;
    if (init.form) { headers.set('content-type', 'application/x-www-form-urlencoded'); body = new URLSearchParams(init.form).toString(); }
    if (init.json !== undefined) { headers.set('content-type', 'application/json'); body = JSON.stringify(init.json); }
    const res = await fetch(u, { ...init, headers, body, redirect: 'manual' });
    this.store(u, res.headers.getSetCookie());
    const text = await res.text();
    return { status: res.status, location: res.headers.get('location'), text, json: () => JSON.parse(text), headers: res.headers };
  }

  /** Panggilan API BFF dengan header anti-CSRF. */
  api(base: string) {
    return async (path: string, init: RequestInit & { json?: unknown } = {}) => {
      const r = await this.fetch(`${base}${path}`, { ...init, headers: { 'x-lemone-request': '1', origin: base.replace(':4000', ':3001'), ...(init.headers ?? {}) } });
      return r;
    };
  }
}

function base32Decode(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = ''; for (const ch of clean) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** Keycloak memakai byte mentah string secret (bukan base32) untuk HMAC; tampilan base32 hanya untuk aplikasi autentikator. */
export function totp(secret: string, at = Date.now(), encoding: 'raw' | 'base32' = 'raw'): string {
  const counter = Math.floor(at / 1000 / 30);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const key = encoding === 'base32' ? base32Decode(secret) : Buffer.from(secret, 'utf8');
  const h = createHmac('sha1', key).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000;
  return String(code).padStart(6, '0');
}

function formAction(html: string, formId: string): string | null {
  const m = html.match(new RegExp(`<form[^>]*id="${formId}"[^>]*action="([^"]+)"`)) ?? html.match(new RegExp(`<form[^>]*action="([^"]+)"[^>]*id="${formId}"`));
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

export interface KcCreds { username: string; password: string; newPassword?: string; totpSecret?: { value?: string } }

/**
 * Ikuti pengalihan sampai mendarat di callback aplikasi (host 3001/3002) atau gagal.
 * Mengisi form login, ganti kata sandi, dan konfigurasi/isi OTP bila diminta.
 */
export async function driveKeycloak(b: Browser, startUrl: string, creds: KcCreds, opts: { maxSteps?: number } = {}): Promise<{ callbackUrl: string | null; lastHtml: string; steps: string[] }> {
  let url = startUrl;
  const steps: string[] = [];
  let html: string | null = null; // HTML hasil POST yang belum diproses
  let lastHtml = '';
  const post = async (action: string, form: Record<string, string>) => {
    const p = await b.fetch(action, { method: 'POST', form });
    if (p.status >= 300 && p.location) { url = new URL(p.location, action).href; html = null; return; }
    html = p.text; url = action;
  };
  for (let i = 0; i < (opts.maxSteps ?? 25); i++) {
    if (html === null) {
      if (/^http:\/\/localhost:300[12]\//.test(url)) return { callbackUrl: url, lastHtml, steps };
      const r = await b.fetch(url);
      if (r.status >= 300 && r.status < 400 && r.location) {
        const loc = new URL(r.location, url).href;
        if (/^http:\/\/localhost:300[12]\//.test(loc)) return { callbackUrl: loc, lastHtml, steps };
        url = loc; steps.push(`redirect → ${new URL(loc).pathname}`);
        continue;
      }
      html = r.text;
    }
    const page: string = html;
    lastHtml = page;
    html = null;
    if (page.includes('id="kc-form-login"')) {
      if (steps.includes('login form') && steps[steps.length - 1] === 'login form') return { callbackUrl: null, lastHtml, steps: [...steps, 'login ditolak'] };
      steps.push('login form');
      await post(formAction(page, 'kc-form-login')!, { username: creds.username, password: creds.password, credentialId: '' });
      continue;
    }
    if (page.includes('name="password-new"')) {
      steps.push('update password');
      const np = creds.newPassword ?? creds.password;
      await post(formAction(page, 'kc-passwd-update-form')!, { 'password-new': np, 'password-confirm': np });
      continue;
    }
    if (page.includes('name="totpSecret"')) {
      const secretRaw = page.match(/name="totpSecret"[^>]*value="([^"]+)"/)?.[1] ?? page.match(/value="([^"]+)"[^>]*name="totpSecret"/)?.[1];
      if (!creds.totpSecret) throw new Error('OTP diminta tetapi harness tidak menyiapkan totpSecret');
      if (!secretRaw) throw new Error('totpSecret tidak ditemukan di halaman');
      creds.totpSecret.value = secretRaw;
      steps.push('configure OTP');
      await post(formAction(page, 'kc-totp-settings-form')!, { totpSecret: secretRaw, totp: totp(secretRaw), userLabel: 'e2e', 'logout-sessions': 'on' });
      continue;
    }
    if (page.includes('id="kc-otp-login-form"') || (page.includes('name="otp"') && !page.includes('name="totpSecret"'))) {
      steps.push('OTP login');
      if (!creds.totpSecret?.value) throw new Error('OTP login diminta tanpa secret');
      await post(formAction(page, 'kc-otp-login-form')!, { otp: totp(creds.totpSecret.value) });
      continue;
    }
    if (page.includes('name="confirmLogout"')) {
      const action = formAction(page, 'kc-logout-confirm') ?? formAction(page, 'kc-logout-form');
      if (action) { steps.push('confirm logout'); await post(action, { confirmLogout: 'Logout' }); continue; }
    }
    return { callbackUrl: null, lastHtml, steps: [...steps, `berhenti di ${new URL(url).pathname} (${page.match(/data-page-id="([^"]+)"/)?.[1] ?? '?'})`] };
  }
  return { callbackUrl: null, lastHtml, steps: [...steps, 'terlalu banyak langkah'] };
}

/** Lempar callback (yang seharusnya ke host 300x) langsung ke API :4000. */
export function callbackToApi(callbackUrl: string, app: 'work' | 'chat'): string {
  const u = new URL(callbackUrl);
  return `http://localhost:4000/auth/${app}/callback${u.search}`;
}
