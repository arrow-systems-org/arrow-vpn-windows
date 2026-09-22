import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('package targets the modern Electron stack', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.devDependencies.electron, '44.4.1');
  assert.equal(pkg.dependencies['electron-store'], '11.0.2');
  assert.equal(pkg.dependencies['electron-updater'], '6.8.9');
});

test('renderer uses the isolated bridge', () => {
  const renderer = read('renderer.js');
  assert.match(renderer, /window\.arrow\./);
  assert.doesNotMatch(renderer, /window\.apiVPN/);
  assert.doesNotMatch(renderer, /navigator\.clipboard/);
});

test('main process is ESM and keeps TLS verification enabled', () => {
  const main = read('main.js');
  assert.match(main, /import Store from 'electron-store'/);
  assert.doesNotMatch(main, /require\(/);
  assert.doesNotMatch(main, /NODE_TLS_REJECT_UNAUTHORIZED/);
});

test('preload remains a sandbox-compatible CommonJS bridge', () => {
  const preload = read('preload.cjs');
  assert.match(preload, /contextBridge\.exposeInMainWorld\('arrow'/);
  assert.match(preload, /IPC channel not allowed/);
});

test('server reachability UI distinguishes pending nodes from offline nodes', () => {
  const renderer = read('renderer.js');
  const css = read('style.css');
  assert.match(renderer, /estado: 'checking'/);
  assert.match(renderer, /t\('checking-node'\)/);
  assert.match(renderer, /btn\.disabled = true/);
  assert.match(renderer, /aria-busy/);
  assert.match(css, /\.dot-comprobando/);
  assert.match(css, /\.server-option\.checking/);
  assert.match(css, /radar-pulse/);
});
