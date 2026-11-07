import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { addRuDirectRouting, looksLikeSrs, RU_DOMAIN_SUFFIXES } from '../smart-routing.js';
import { ARROW_RULE_MIRRORS, refreshRuRuleSets, validateSrs } from '../rule-set-updater.js';

function fakeSrs(text = 'arrow-test') {
    // Test fixture exercises the SRS header + zlib container, not contents.
    return Buffer.concat([Buffer.from('SRS\x01', 'binary'), zlib.deflateSync(Buffer.from(text))]);
}
function baseConfig() {
    return { dns: { reverse_mapping: true, servers: [{ type: 'local', tag: 'dns-local' }], final: 'dns-remote-v4' },
        route: { rules: [{ ip_cidr: ['127.0.0.0/8'], outbound: 'direct' }, { ip_cidr: ['203.0.113.10/32'], outbound: 'direct' }], final: 'proxy' } };
}

test('RU Direct is opt-in; disabled config stays bit-for-bit unchanged', () => {
    const original = baseConfig(); const before = JSON.stringify(original);
    assert.deepEqual(addRuDirectRouting(original, { enabled: false }), { applied: false, available: [] });
    assert.equal(JSON.stringify(original), before);
});

test('offline RU domains are direct and non-RU defaults remain proxy', () => {
    const config = baseConfig();
    const result = addRuDirectRouting(config, { enabled: true, rulesDir: path.join(os.tmpdir(), 'no-arrow-rule-set-here') });
    assert.deepEqual(result.available, []);
    assert.equal(config.route.final, 'proxy');
    assert.equal(config.route.rules[0].action, 'sniff');
    assert.equal(config.route.rules[1].action, 'hijack-dns');
    assert.equal(config.route.rules[2].action, 'hijack-dns');
    assert.equal(config.route.rules[3].ip_cidr[0], '127.0.0.0/8');
    assert.equal(config.route.rules[4].ip_cidr[0], '203.0.113.10/32');
    const explicit = config.route.rules.find(x => x.domain_suffix);
    for (const suffix of ['ru', 'su', 'xn--p1ai', 'vk.com', 'ok.ru', 'ozon.com']) {
        assert.ok(explicit.domain_suffix.includes(suffix), suffix);
    }
    assert.equal(explicit.outbound, 'direct');
    assert.equal(config.dns.rules[0].server, 'dns-local');
    assert.ok(!config.route.rule_set);
});

test('valid local SRS are both added, with proper tags and absolute paths', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arrow-routing-'));
    try {
        fs.writeFileSync(path.join(dir, 'geosite-category-ru.srs'), fakeSrs('sites'));
        fs.writeFileSync(path.join(dir, 'geoip-ru.srs'), fakeSrs('IPs'));
        const config = baseConfig();
        const result = addRuDirectRouting(config, { enabled: true, rulesDir: dir });
        assert.deepEqual(result.available, ['arrow-geosite-ru', 'arrow-geoip-ru']);
        assert.equal(config.route.rule_set.length, 2);
        assert.ok(config.route.rules.some(x => x.rule_set === 'arrow-geosite-ru'));
        assert.ok(config.route.rules.some(x => x.rule_set === 'arrow-geoip-ru'));
        assert.ok(config.dns.rules.some(x => x.rule_set === 'arrow-geosite-ru'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('reject HTML and corrupted binary and keep cached rule-set', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arrow-updater-'));
    try {
        const old = fakeSrs('known-good');
        const file = path.join(dir, 'geoip-ru.srs');
        fs.writeFileSync(file, old);
        const result = await refreshRuRuleSets(dir, {
            mirrors: ['https://first.test/rulesets/ru', 'https://second.test/rulesets/ru'],
            upstream: {},
            fetchBytes: async () => Buffer.from('<html>404</html>')
        });
        assert.equal(result['arrow-geoip-ru'].status, 'cached');
        assert.deepEqual(fs.readFileSync(file), old);
        assert.equal(validateSrs(Buffer.from('<html>404</html>')), false);
        assert.equal(validateSrs(Buffer.from('SRS\x01broken', 'binary')), false);
        assert.equal(looksLikeSrs(fakeSrs()), true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('downloader prefers official GitHub, falls back to Arrow mirrors, and updates cache atomically', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arrow-updater-'));
    try {
        const urls = [];
        const result = await refreshRuRuleSets(dir, {
            mirrors: ['https://first.example/rulesets/ru', 'https://second.example/rulesets/ru'],
            upstream: {
                'geosite-category-ru.srs': 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ru.srs',
                'geoip-ru.srs': 'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-ru.srs'
            },
            fetchBytes: async (url) => {
                urls.push(url);
                if (url.includes('raw.githubusercontent.com') || url.includes('first.example')) throw new Error('Source down');
                return fakeSrs(url.split('/').pop());
            }
        });
        assert.equal(urls.length, 6);
        assert.ok(urls[0].startsWith('https://raw.githubusercontent.com/'));
        assert.ok(urls[3].startsWith('https://raw.githubusercontent.com/'));
        assert.equal(result['arrow-geosite-ru'].status, 'updated');
        assert.equal(result['arrow-geosite-ru'].source, 'second.example');
        assert.equal(result['arrow-geoip-ru'].status, 'updated');
        assert.equal(validateSrs(fs.readFileSync(path.join(dir, 'geoip-ru.srs'))), true);
        assert.equal(fs.readdirSync(dir).filter(x => x.endsWith('.tmp')).length, 0);
        assert.equal(ARROW_RULE_MIRRORS.length, 3);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('subscriptions cannot disable user choice; routing is applied to local config only', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    const renderer = fs.readFileSync(new URL('../renderer.js', import.meta.url), 'utf8');
    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.match(main, /smartRouting: Boolean\(configEnMemoria.smartRouting\)/);
    assert.match(main, /addRuDirectRouting\(config, \{ enabled: true, rulesDir: ruRulesDir \}\)/);
    assert.match(main, /refreshRuRuleSets\(ruRulesDir\)/);
    assert.match(renderer, /toggleSmartRouting\.checked = settings.smartRouting === true/);
    assert.match(html, /id="toggle-smart-routing"/);
    assert.ok(RU_DOMAIN_SUFFIXES.length >= 15);
});
