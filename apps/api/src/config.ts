import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  AUTH_MODE: z.enum(['local', 'oidc']).default('local'),
  REGISTRATION_OPEN: z.string().default('true').transform((v) => v === 'true'),
  OIDC_ISSUER: z.string().url().default('http://localhost:8080/realms/lemone'),
  KC_ADMIN_URL: z.string().url().default('http://localhost:8080'),
  KC_REALM: z.string().default('lemone'),
  IDP_PROVISIONER_CLIENT_ID: z.string().default('lemone-provisioner'),
  IDP_PROVISIONER_CLIENT_SECRET: z.string().default(''),
  OIDC_CLIENT_WORK_ID: z.string().default('lemone-work-web'),
  OIDC_CLIENT_WORK_SECRET: z.string().default(''),
  OIDC_CLIENT_CHAT_ID: z.string().default('lemone-chat-web'),
  OIDC_CLIENT_CHAT_SECRET: z.string().default(''),
  API_AUDIENCE: z.string().default('lemone-api'),
  WORK_PUBLIC_URL: z.string().url().default('http://localhost:3001'),
  CHAT_PUBLIC_URL: z.string().url(),
  SESSION_ENC_KEY: z.string().min(32),
  INVITATION_TTL_HOURS: z.coerce.number().default(24),
  ACTIVATION_TTL_MINUTES: z.coerce.number().default(30),
  HR_INBOX_USERNAME: z.string().default('hr'),
  BOOTSTRAP_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  ERP_ADAPTER: z.enum(['demo', 'http']).default('demo'),
  ERP_BASE_URL: z.string().default(''),
  ERP_API_KEY: z.string().default(''),
  AI_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
  AI_API_KEY: z.string().default(''),
  BUSINESS_TZ: z.string().default('Asia/Jakarta'),
  WORKER_ID: z.string().default(`worker-${process.pid}`),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;
export function config(): Config {
  if (!cached) {
    const r = schema.safeParse(process.env);
    if (!r.success) {
      const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Konfigurasi lingkungan tidak lengkap: ${msg}`);
    }
    cached = r.data;
  }
  return cached;
}

export const APPS = {
  WORK: { app: 'WORK', cookie: 'lw_sid', publicUrl: () => config().WORK_PUBLIC_URL, clientId: () => config().OIDC_CLIENT_WORK_ID, secret: () => config().OIDC_CLIENT_WORK_SECRET },
  CHAT: { app: 'CHAT', cookie: 'lc_sid', publicUrl: () => config().CHAT_PUBLIC_URL, clientId: () => config().OIDC_CLIENT_CHAT_ID, secret: () => config().OIDC_CLIENT_CHAT_SECRET },
} as const;
export type AppKey = keyof typeof APPS;
export const APP_PATH: Record<string, AppKey> = { work: 'WORK', chat: 'CHAT' };
