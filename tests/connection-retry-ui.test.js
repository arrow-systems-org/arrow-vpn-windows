import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('connection flow retries transient failures up to five times', () => {
  const main = read('main.js');
  assert.match(main, /const MAX_CONNECT_ATTEMPTS = 5/);
  assert.match(main, /for \(let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt \+= 1\)/);
  assert.match(main, /esErrorConexionReintentable/);
  assert.match(main, /vpn-conexion-reintento/);
  assert.match(main, /err-retries-exhausted/);
});

test('retry cleanup preserves kill switch and cancellation invalidates the active operation', () => {
  const main = read('main.js');
  assert.match(main, /restaurarRedWindows\('connection-retry', \{ preserveKillSwitch \}\)/);
  assert.match(main, /connectionOperationId \+= 1/);
  assert.match(main, /asegurarOperacionConexionActiva\(operationId\)/);
  assert.match(main, /user-disconnect-final/);
});

test('background health checks run concurrently and do not gate CONNECTED', () => {
  const main = read('main.js');
  const health = main.match(/async function probarSaludTunel\(\) \{[\s\S]*?\n\}/u)?.[0] || '';
  assert.match(health, /Promise\.all\(urls\.map/);
  assert.match(health, /--max-time', '6'/);
  assert.match(health, /detectportal\.firefox\.com/);
  assert.match(health, /msftconnecttest\.com/);
  assert.match(health, /captive\.apple\.com/);
  assert.doesNotMatch(health, /arrow-x\.org|arrow-x\.com|arrow-updates\.xyz/);
  assert.match(main, /void verificarSaludTunelEnSegundoPlano\(operationId\)/);
  const connectHandler = main.match(/trustedIpcOn\('conectar-vpn',[\s\S]*?trustedIpcOn\('desconectar-vpn'/u)?.[0] || '';
  assert.doesNotMatch(connectHandler, /await probarSaludTunel\(\);/);
  const retryable = main.match(/const reintentables = \[([\s\S]*?)\];/u)?.[0] || '';
  assert.doesNotMatch(retryable, /health_check_failed/);
});

test('renderer lets the connect button cancel an in-progress connection', () => {
  const renderer = read('renderer.js');
  assert.match(renderer, /if \(estaConectando\) \{[\s\S]*?window\.arrow\.send\('desconectar-vpn'\)/u);
  assert.match(renderer, /btnTexto\.innerText = t\('msg-cancelar'\)/);
  assert.match(renderer, /vpn-conexion-intento/);
  assert.match(renderer, /vpn-conexion-reintento/);
});

test('long errors use a compact error card while short notifications remain toasts', () => {
  const renderer = read('renderer.js');
  const html = read('index.html');
  const css = read('style.css');
  assert.match(renderer, /mensaje\.length > 72/);
  assert.match(renderer, /mostrarTarjetaError/);
  assert.match(html, /id="connection-error-card"/);
  assert.match(css, /\.connection-error-card/);
  assert.match(css, /max-width: 350px/);
  assert.match(css, /\.toast\.warning/);
});

test('preload exposes only the new receive-only retry progress channels', () => {
  const preload = read('preload.cjs');
  assert.match(preload, /'vpn-conexion-intento'/);
  assert.match(preload, /'vpn-conexion-reintento'/);
  assert.match(preload, /'vpn-health-verificado'/);
  assert.doesNotMatch(preload, /'vpn-health-advertencia'/);
  const sendBlock = preload.match(/const SEND_CHANNELS = new Set\(\[[\s\S]*?\]\);/u)?.[0] || '';
  assert.doesNotMatch(sendBlock, /vpn-conexion-intento|vpn-conexion-reintento/);
});


test('failed background Internet verification is log-only and never shown to the user', () => {
  const main = read('main.js');
  const renderer = read('renderer.js');
  const preload = read('preload.cjs');
  assert.match(main, /connectionHealthState = 'DEGRADED'/);
  assert.match(main, /registrarErrorApp\('health-check-background'/);
  assert.match(main, /registrarErrorApp\('health-check-background-exception'/);
  assert.doesNotMatch(main, /webContents\.send\('vpn-health-advertencia'/);
  assert.doesNotMatch(renderer, /vpn-health-advertencia|msg-health-degraded/);
  assert.doesNotMatch(preload, /vpn-health-advertencia/);
});
