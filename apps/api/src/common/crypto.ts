import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

function key(): Buffer {
  const raw = config().SESSION_ENC_KEY;
  const b = Buffer.from(raw, 'base64');
  if (b.length === 32) return b;
  return createHash('sha256').update(raw).digest();
}

/** AES-256-GCM. Output: iv(12) | tag(16) | ciphertext */
export function encryptJson(obj: unknown): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

export function decryptJson<T>(buf: Buffer): T {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8')) as T;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Kata sandi sementara acak: 12 karakter, tanpa huruf yang mirip. */
export function temporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const b = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[b[i] % alphabet.length];
  return out;
}

/** Redaksi token/secret dari teks log. */
export function redact(s: string): string {
  return s
    .replace(/([?&](t|token|code|state|access_token|refresh_token|id_token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer [redacted]');
}
