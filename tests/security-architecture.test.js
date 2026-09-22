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

test('selected-node connection performs an end-to-end health check', () => {
  const main = read('main.js');
  assert.match(main, /async function probarSaludTunel/);
  assert.match(main, /health_check_failed/);
  assert.match(main, /await probarSaludTunel\(\)/);
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
