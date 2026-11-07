import test from 'node:test';
import assert from 'node:assert/strict';
import { compareReleaseVersions, parseReleaseVersion, lookupLatestInMirrors, rankMirrorCandidates } from '../ota-mirrors.js';

const sources = [
  { id: 'primary', url: 'https://primary.test/windows/stable' },
  { id: 'russia', url: 'https://russia.test/windows/stable' },
  { id: 'github', url: 'https://github.test/latest/download' },
];
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function fakeFetch(table) {
  return async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.match(url, /^https:\/\/.+\/latest\.yml$/);
    const record = table[new URL(url).hostname];
    if (!record) throw new Error('DNS unavailable');
    await wait(record.delay ?? 0);
    if (record.error) throw new Error(record.error);
    return new Response(`version: ${record.version}\nfiles:\n  - url: app.exe\n`, {
      status: record.status ?? 200, headers: { 'Content-Type': 'text/yaml' },
    });
  };
}

test('parse release version from electron-updater metadata', () => {
  assert.equal(parseReleaseVersion('version: 3.1.6\nfiles:\n'), '3.1.6');
  assert.equal(parseReleaseVersion('version: "3.1.6"\n'), '3.1.6');
  assert.equal(parseReleaseVersion('version: 3.1.6-beta.2\n'), '3.1.6-beta.2');
  assert.equal(parseReleaseVersion('version: nope\n'), null);
  assert.equal(parseReleaseVersion('fake: 3.1.6\n'), null);
});

test('stable release outranks same-version prerelease', () => {
  assert.equal(compareReleaseVersions('3.1.6', '3.1.6-beta.9'), 1);
  assert.equal(compareReleaseVersions('3.1.6-beta.2', '3.1.6-beta.11'), -1);
  assert.equal(compareReleaseVersions('3.1.6', '3.1.5'), 1);
  assert.equal(compareReleaseVersions('v3.1.6', '3.1.6'), 0);
  assert.equal(compareReleaseVersions('3.1.10', '3.1.9'), 1);
});

test('fast but outdated mirror never wins over newer release', async () => {
  const result = await lookupLatestInMirrors(sources, { timeoutMs: 1000, fetchImpl: fakeFetch({
    'primary.test': { version: '3.1.5', delay: 1 },
    'russia.test': { version: '3.1.6', delay: 45 },
    'github.test': { version: '3.1.6', delay: 20 },
  }) });
  assert.equal(result.errors.length, 0);
  assert.equal(result.candidates[0].version, '3.1.6');
  assert.ok(['github', 'russia'].includes(result.candidates[0].id));
  assert.equal(result.candidates.at(-1).id, 'primary');
});

test('unreachable mirror is ignored without blocking successful candidates', async () => {
  const result = await lookupLatestInMirrors(sources, { timeoutMs: 500, fetchImpl: fakeFetch({
    'primary.test': { version: '3.1.5', status: 503 },
    'russia.test': { version: '3.1.6' },
    'github.test': { error: 'offline' },
  }) });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].id, 'russia');
  assert.equal(result.errors.length, 2);
});

test('sorting is by version, then latency, then stable list order', () => {
  const sorted = rankMirrorCandidates([
    { index: 2, id: 'c', version: '3.1.6', elapsedMs: 9 },
    { index: 0, id: 'a', version: '3.1.5', elapsedMs: 1 },
    { index: 1, id: 'b', version: '3.1.6', elapsedMs: 9 },
  ]);
  assert.deepEqual(sorted.map(x => x.id), ['b', 'c', 'a']);
});

test('insecure OTA endpoints are rejected', async () => {
  const result = await lookupLatestInMirrors([{ id: 'bad', url: 'http://example.test' }], {
    fetchImpl: fakeFetch({ 'example.test': { version: '3.1.6' } }),
  });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.errors.length, 1);
});
