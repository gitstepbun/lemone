/**
 * Mengambil client secret dari Keycloak lokal/staging memakai admin bootstrap (KC_ADMIN_USER/KC_ADMIN_PASSWORD, dev saja),
 * lalu menulisnya ke .env di akar repo (opsi --write) atau mencetak baris env. Secret tidak pernah dicetak ke log lain.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.env.KC_ADMIN_URL ?? 'http://localhost:8080';
const realm = process.env.KC_REALM ?? 'lemone';
const user = process.env.KC_ADMIN_USER;
const pass = process.env.KC_ADMIN_PASSWORD;

async function main() {
  if (!user || !pass) throw new Error('KC_ADMIN_USER/KC_ADMIN_PASSWORD tidak ada di env');
  const tok = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: 'admin-cli', grant_type: 'password', username: user, password: pass }),
  });
  if (!tok.ok) throw new Error(`Login admin gagal (${tok.status})`);
  const { access_token } = (await tok.json()) as { access_token: string };
  const h = { authorization: `Bearer ${access_token}` };
  const want: Array<[string, string]> = [
    ['lemone-provisioner', 'IDP_PROVISIONER_CLIENT_SECRET'],
    ['lemone-work-web', 'OIDC_CLIENT_WORK_SECRET'],
    ['lemone-chat-web', 'OIDC_CLIENT_CHAT_SECRET'],
  ];
  const lines: string[] = [];
  for (const [clientId, envKey] of want) {
    const list = (await (await fetch(`${base}/admin/realms/${realm}/clients?clientId=${clientId}`, { headers: h })).json()) as Array<{ id: string }>;
    if (!list[0]) throw new Error(`Client ${clientId} tidak ada di realm ${realm}`);
    const sec = (await (await fetch(`${base}/admin/realms/${realm}/clients/${list[0].id}/client-secret`, { headers: h })).json()) as { value: string };
    lines.push(`${envKey}=${sec.value}`);
  }
  if (process.argv.includes('--write')) {
    const envPath = resolve(process.cwd(), '..', '..', '.env');
    let content = readFileSync(envPath, 'utf8');
    for (const l of lines) {
      const [k] = l.split('=');
      content = content.match(new RegExp(`^${k}=.*$`, 'm')) ? content.replace(new RegExp(`^${k}=.*$`, 'm'), l) : `${content.trimEnd()}\n${l}\n`;
    }
    writeFileSync(envPath, content);
    console.log(`Secret ${want.length} client ditulis ke ${envPath}`);
  } else {
    console.log(lines.join('\n'));
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
