import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('OTA no longer hardcodes the legacy :7777 endpoint', () => {
  const main = read('main.js');
  const pkg = read('package.json');
  assert.doesNotMatch(main, /de\.arrow-x\.org:7777/);
  assert.doesNotMatch(pkg, /de\.arrow-x\.org:7777/);
});

test('OTA defines primary, Russian, GitHub and emergency sources', () => {
  const main = read('main.js');
  assert.match(main, /https:\/\/updates\.arrow-x\.org\/windows\/stable/);
  assert.match(main, /https:\/\/updates\.ru\.arrow-x\.com\/windows\/stable/);
  assert.match(main, /github\.com\/arrow-systems-org\/arrow-vpn-windows\/releases\/latest\/download/);
  assert.match(main, /https:\/\/arrow-updates\.xyz\/windows\/stable/);
});

test('OTA checks and downloads with automatic mirror failover', () => {
  const main = read('main.js');
  assert.match(main, /async function comprobarActualizacionConFailover/);
  assert.match(main, /async function descargarActualizacionConFailover/);
  assert.match(main, /autoUpdater\.setFeedURL/);
  assert.match(main, /mirror desincronizado/);
  assert.match(main, /await autoUpdater\.downloadUpdate\(\)/);
});

test('manual OTA download IPC uses mirror failover instead of a direct provider download', () => {
  const main = read('main.js');
  const handler = main.match(/trustedIpcOn\('ota-download',[\s\S]*?\n}\);/);
  assert.ok(handler, 'ota-download handler should exist');
  assert.match(handler[0], /await descargarActualizacionConFailover\(\)/);
  assert.doesNotMatch(handler[0], /await autoUpdater\.downloadUpdate\(\)/);
});
