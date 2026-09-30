import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('runtime requires sing-box-lx 1.14.1-lx.4+ and checks config before run', () => {
  const main = read('main.js');
  assert.match(main, /sing-box-lx_required/);
  assert.match(main, /lx < 4/);
  assert.match(main, /\['check', '-c', configPath\]/);
  assert.doesNotMatch(main, /ENABLE_DEPRECATED_LEGACY_DNS_SERVERS/);
  assert.doesNotMatch(main, /ENABLE_DEPRECATED_MISSING_DOMAIN_RESOLVER/);
});

test('TUN strict routing is enabled and silent RU split tunneling is gone', () => {
  const main = read('main.js');
  assert.match(main, /strict_route: true/);
  assert.doesNotMatch(main, /domain_suffix:\s*\[['"]ru['"]/);
});

test('credentials are encrypted at rest and not returned to renderer', () => {
  const main = read('main.js');
  const sub = read('subscription.js');
  assert.match(main, /servidoresCifrados/);
  assert.match(main, /settingsPublicos\(\)/);
  assert.match(sub, /secure_storage_unavailable/);
  assert.doesNotMatch(sub, /return 'plain:' \+ subUrl/);
});

test('kill switch creates allow rules and blocks default outbound traffic', () => {
  const main = read('main.js');
  assert.match(main, /Arrow_KS_Engine/);
  assert.match(main, /Arrow_KS_TUN/);
  assert.match(main, /DefaultOutboundAction Block/);
  assert.match(main, /firewall_snapshot\.json/);
});

test('selected-node connection verifies Internet in background without gating the tunnel', () => {
  const main = read('main.js');
  assert.match(main, /async function probarSaludTunel/);
  assert.match(main, /async function verificarSaludTunelEnSegundoPlano/);
  assert.match(main, /setNetworkState\('CONNECTED', 'connection-ready'\)/);
  assert.match(main, /void verificarSaludTunelEnSegundoPlano\(operationId\)/);
  const connectHandler = main.match(/trustedIpcOn\('conectar-vpn',[\s\S]*?trustedIpcOn\('desconectar-vpn'/u)?.[0] || '';
  assert.doesNotMatch(connectHandler, /await probarSaludTunel\(\);/);
});

test('renderer does not receive or submit raw node URIs', () => {
  const renderer = read('renderer.js');
  assert.doesNotMatch(renderer, /\.vless/);
  assert.doesNotMatch(renderer, /vlessKey/);
  assert.match(renderer, /copiar-nodo/);
});


test('subscription fetches cannot downgrade to HTTP and are size capped', () => {
  const sub = read('subscription.js');
  assert.match(sub, /new URL\(resp\.url\)\.protocol !== 'https:'/);
  assert.match(sub, /MAX_SUBSCRIPTION_BYTES = 5 \* 1024 \* 1024/);
});

test('sing-box traffic log defaults to warnings instead of per-connection info', () => {
  const main = read('main.js');
  assert.match(main, /log: \{ level: 'warn', output: singboxLogPath \}/);
});


test('IPv6 is opt-in and negotiated per node instead of being forced globally', () => {
  const main = read('main.js');
  const renderer = read('renderer.js');
  const html = read('index.html');
  assert.match(main, /ipv6Auto: false/);
  assert.match(main, /async function detectarSoporteIPv6Nodo/);
  assert.match(main, /function probarIPv6ViaSocks5/);
  assert.match(main, /tls\.connect/);
  assert.match(main, /secureConnect/);
  assert.match(main, /replyLength = 22/);
  assert.match(main, /rejectUnauthorized: true/);
  assert.match(main, /cloudflare-dns\.com/);
  assert.match(main, /Remove-NetIPAddress/);
  assert.match(main, /IPV6_CAPABILITY_CACHE_TTL_MS/);
  assert.match(main, /address: ipv6Activo/);
  assert.match(main, /strategy: ipv6Activo \? 'prefer_ipv4' : 'ipv4_only'/);
  assert.match(main, /await aplicarConfiguracionTun\(ipv6Activo\)/);
  assert.match(renderer, /toggle-ipv6-auto/);
  assert.match(html, /id="toggle-ipv6-auto"/);
});
