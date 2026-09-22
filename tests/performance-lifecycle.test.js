import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('successful connection UI has no artificial multi-second delay', () => {
  const renderer = read('renderer.js');
  const handler = renderer.match(/window\.arrow\.on\('vpn-conectada-exito',[\s\S]*?\n    \}\);/u)?.[0] || '';
  assert.match(handler, /estaConectado = true/);
  assert.doesNotMatch(handler, /setTimeout/u);
  assert.doesNotMatch(renderer, /4500/);
});

test('disconnect completion is acknowledged by the main process', () => {
  const main = read('main.js');
  const preload = read('preload.cjs');
  const renderer = read('renderer.js');
  assert.match(main, /event\.reply\('vpn-desconectada-exito'\)/);
  assert.match(preload, /'vpn-desconectada-exito'/);
  assert.match(renderer, /window\.arrow\.on\('vpn-desconectada-exito'/);
  assert.doesNotMatch(renderer, /1200/);
});

test('clean app quit has an immediate fast path and no duplicate exit cleanup', () => {
  const main = read('main.js');
  assert.match(main, /if \(!necesitaLimpiezaActiva\(\)\) \{\s*quitCleanupDone = true;\s*return;/u);
  assert.match(main, /ocultarInterfazParaSalida\(\)/);
  assert.match(main, /if \(quitCleanupDone \|\| !necesitaLimpiezaActiva\(\)\) return;/);
});

test('sing-box lifecycle is event-driven instead of fixed startup and shutdown sleeps', () => {
  const main = read('main.js');
  assert.match(main, /proxyProcess\.once\('spawn'/);
  assert.match(main, /esperarSalidaProceso\(child, 450\)/);
  assert.doesNotMatch(main, /Date\.now\(\) \+ 5000/);
  assert.doesNotMatch(main, /await sleep\(300\)/);
  assert.doesNotMatch(main, /}, 1500\);/);
});

test('startup recovery is conditional and survives crashes through a persistent dirty marker', () => {
  const main = read('main.js');
  assert.match(main, /network_dirty\.flag/);
  assert.match(main, /function marcarRedSucia\(\)/);
  assert.match(main, /function marcarRedLimpia\(\)/);
  assert.match(main, /if \(hayArtefactosPersistentes\(\)\) \{[\s\S]*?await restaurarRedWindows\('startup'\)/u);
});

test('first connection can reuse engine validation and a recent radar resolution', () => {
  const main = read('main.js');
  assert.match(main, /motorLXValidationCache/);
  assert.match(main, /obtenerIpRadarReciente/);
  assert.match(main, /REACHABILITY_CACHE_TTL_MS/);
  assert.match(main, /node address reused from radar/);
});

test('performance timings are recorded without node addresses or credentials', () => {
  const main = read('main.js');
  assert.match(main, /\[perf\]\[\$\{scope\}\]/);
  assert.match(main, /crearTrazaRendimiento\('connect'\)/);
  assert.match(main, /crearTrazaRendimiento\('disconnect'\)/);
  assert.match(main, /crearTrazaRendimiento\('quit'\)/);
});

test('preference-only writes do not re-encrypt the whole server map on connect', () => {
  const main = read('main.js');
  assert.match(main, /function persistirSettings\(\{ persistServers = true \} = \{\}\)/);
  assert.match(main, /configEnMemoria\.ultimoServidor = serverId;\s*persistirSettings\(\{ persistServers: false \}\);/u);
});
