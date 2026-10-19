import * as client from 'openid-client';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { APPS, config, type AppKey } from '../config';

const configs = new Map<AppKey, Promise<client.Configuration>>();

/** Konfigurasi OIDC per aplikasi, dari discovery IdP. Issuer boleh memuat path realm. */
export function oidcConfig(app: AppKey): Promise<client.Configuration> {
  let p = configs.get(app);
  if (!p) {
    const c = config();
    const a = APPS[app];
    const insecure = c.OIDC_ISSUER.startsWith('http://');
    p = client
      .discovery(new URL(c.OIDC_ISSUER), a.clientId(), undefined, client.ClientSecretPost(a.secret()), {
        execute: insecure ? [client.allowInsecureRequests] : [],
      })
      .then((cfg) => {
        const meta = cfg.serverMetadata();
        if (meta.issuer !== c.OIDC_ISSUER) throw new Error(`Issuer discovery (${meta.issuer}) tidak cocok dengan OIDC_ISSUER`);
        return cfg;
      });
    configs.set(app, p);
    p.catch(() => configs.delete(app));
  }
  return p;
}

export function redirectUri(app: AppKey): string {
  return `${APPS[app].publicUrl()}/api/auth/${app.toLowerCase()}/callback`;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
export async function verifyAccessToken(token: string): Promise<JWTPayload> {
  const c = config();
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${c.OIDC_ISSUER}/protocol/openid-connect/certs`));
  const { payload } = await jwtVerify(token, jwks, { issuer: c.OIDC_ISSUER, audience: c.API_AUDIENCE, clockTolerance: 30 });
  if (payload.typ && payload.typ !== 'Bearer') throw new Error('Bukan access token');
  return payload;
}

export { client };
