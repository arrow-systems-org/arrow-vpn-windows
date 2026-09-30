import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('window cannot be resized below the base 380x600 layout', () => {
  const main = read('main.js');
  assert.match(main, /const APP_WINDOW_WIDTH = 380;/);
  assert.match(main, /const APP_WINDOW_HEIGHT = 600;/);
  assert.match(main, /width: APP_WINDOW_WIDTH/);
  assert.match(main, /height: APP_WINDOW_HEIGHT/);
  assert.match(main, /minWidth: APP_WINDOW_WIDTH/);
  assert.match(main, /minHeight: APP_WINDOW_HEIGHT/);
});

test('frameless window keeps a stable drag region after resizing', () => {
  const css = read('style.css');
  assert.match(css, /\.title-bar\s*\{[\s\S]*?height:\s*80px;/);
  assert.match(css, /\.title-bar-drag-area\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?right:\s*90px;[\s\S]*?-webkit-app-region:\s*drag;/);
  assert.match(css, /\.window-controls\s*\{[\s\S]*?-webkit-app-region:\s*no-drag;/);
  assert.match(css, /\.header h2\s*\{[\s\S]*?-webkit-app-region:\s*drag;/);
});

test('automatic IPv6 setting is immutable while a connection is active', () => {
  const main = read('main.js');
  const renderer = read('renderer.js');
  const html = read('index.html');

  assert.match(html, /id="row-ipv6-auto"/);
  assert.match(renderer, /function actualizarDisponibilidadIpv6Switch\(\)/);
  assert.match(renderer, /const bloqueado = estaConectado \|\| estaConectando \|\| estaDesconectando;/);
  assert.match(renderer, /toggleIpv6Auto\.disabled = bloqueado;/);
  assert.match(renderer, /ipv6-change-disabled/);
  assert.match(main, /if \(key === 'ipv6Auto' && networkState !== 'DISCONNECTED'\) continue;/);
});
