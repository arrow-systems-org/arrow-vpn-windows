import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

test('support panel has a contextual update button next to the version', () => {
  const html = read('index.html');
  assert.match(html, /id="support-version-item"/);
  assert.match(html, /id="app-version-text"/);
  assert.match(html, /id="support-latest-version"/);
  assert.match(html, /id="support-update-btn"/);
  assert.match(html, /data-i18n-title="ota-check-btn"/);
  const css = read('style.css');
  assert.match(css, /\.support-update-btn\.has-update/);
  assert.match(css, /\.support-version-item\.has-update #app-version-text/);
});

test('Later hides the modal only for this app session and leaves the download action', () => {
  const renderer = read('renderer.js');
  assert.match(renderer, /let otaDismissedVersion = null/);
  assert.match(renderer, /otaDismissedVersion = otaKnownVersion;\s*otaHideModal\(\)/);
  assert.match(renderer, /if \(otaDismissedVersion !== otaKnownVersion\) otaShowModal\(\)/);
  assert.match(renderer, /otaState === 'available'.*otaStartDownload\(\)/s);
  assert.match(renderer, /window\.arrow\.send\('ota-download'\)/);
  assert.doesNotMatch(read('main.js'), /store\.set\(['"]otaDismissedVersion/);
});

test('Session messenger name is never translated into meeting/sesión', () => {
  const renderer = read('renderer.js');
  assert.match(renderer, /"lbl-sesion": "ID de Session"/);
  assert.match(renderer, /"lbl-sesion": "Session ID"/);
  assert.match(renderer, /"lbl-sesion": "ID Session"/);
  assert.doesNotMatch(renderer, /"lbl-sesion": "ID de Sesión"/);
});

test('OTA mirror code is shipped in electron-builder files and IPC is restricted', () => {
  const build = JSON.parse(read('package.json'));
  assert.equal(build.version, '3.1.6');
  assert.ok(build.build.files.includes('ota-mirrors.js'));
  const bridge = read('preload.cjs');
  assert.match(bridge, /'ota:checking'/);
  assert.match(bridge, /'ota:check-result'/);
  assert.match(bridge, /'ota-check'/);
});


test('Windows tray icon displays the Arrow VPN tooltip', () => {
  const main = read('main.js');
  assert.match(main, /tray\.setToolTip\('Arrow VPN'\)/);
});
