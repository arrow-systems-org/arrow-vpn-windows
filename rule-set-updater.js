/**
 * Arrow RU rule-set updater: official upstream GitHub first, then
 * three Arrow VPN mirrors as fallback. Never replaces a known-good file with HTML,
 * a partial transfer or malformed SRS data. Does NOT modify sing-box.exe.
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import { RU_RULE_SETS, validateLocalSrs } from './smart-routing.js';

export const ARROW_RULE_MIRRORS = Object.freeze([
    'https://updates.arrow-x.org/rulesets/ru',
    'https://updates.ru.arrow-x.com/rulesets/ru',
    'https://arrow-updates.xyz/rulesets/ru'
]);
export const UPSTREAM_RULE_SETS = Object.freeze({
    'geosite-category-ru.srs': 'https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ru.srs',
    'geoip-ru.srs': 'https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-ru.srs'
});
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 3800;

/** Node network request with hard size cap, TLS verification, redirects only to HTTPS. */
export function downloadRule(url, { timeoutMs = TIMEOUT_MS, redirects = 3 } = {}) {
    return new Promise((resolve, reject) => {
        let target;
        try { target = new URL(url); } catch (e) { return reject(e); }
        if (target.protocol !== 'https:' || target.username || target.password) return reject(new Error('HTTPS required'));
        const req = https.get(target, {
            timeout: timeoutMs, headers: { 'User-Agent': 'ArrowVPN-RU-Rules/1', 'Accept': 'application/octet-stream', 'Cache-Control': 'no-cache' }
        }, res => {
            const status = res.statusCode || 0;
            if ([301, 302, 307, 308].includes(status) && res.headers.location) {
                res.resume();
                if (redirects <= 0) return reject(new Error('Too many redirects'));
                let next;
                try { next = new URL(res.headers.location, target); } catch (e) { return reject(e); }
                if (next.protocol !== 'https:') return reject(new Error('Insecure redirect'));
                return downloadRule(next.href, { timeoutMs, redirects: redirects - 1 }).then(resolve, reject);
            }
            if (status !== 200) { res.resume(); return reject(new Error('HTTP ' + status)); }
            if (Number(res.headers['content-length'] || 0) > MAX_BYTES) {
                res.destroy(); return reject(new Error('Rule-set too large'));
            }
            const chunks = []; let size = 0;
            res.on('data', chunk => {
                size += chunk.length;
                if (size > MAX_BYTES) { res.destroy(new Error('Rule-set too large')); return; }
                chunks.push(chunk);
            });
            res.once('end', () => {
                const expected = Number(res.headers['content-length']);
                if (Number.isFinite(expected) && expected > 0 && size !== expected) {
                    return reject(new Error('Incomplete rule-set download'));
                }
                resolve(Buffer.concat(chunks));
            });
            res.once('error', reject);
        });
        req.once('timeout', () => req.destroy(new Error('Rule-set request timed out')));
        req.once('error', reject);
    });
}

export function validateSrs(data) {
    return validateLocalSrs(data);
}

function atomicReplace(filepath, buffer) {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    const tmp = filepath + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    try {
        fs.writeFileSync(tmp, buffer, { flag: 'wx', mode: 0o600 });
        fs.renameSync(tmp, filepath);
    } finally {
        try { fs.unlinkSync(tmp); } catch (_) {}
    }
}

/**
 * @param {string} rulesDir App userData/rule-sets, writable by current user.
 * @param {object} opts Injectable transport for tests (no actual network).
 */
export async function refreshRuRuleSets(rulesDir, { fetchBytes = downloadRule, mirrors = ARROW_RULE_MIRRORS, upstream = UPSTREAM_RULE_SETS } = {}) {
    const results = {};
    for (const item of RU_RULE_SETS) {
        const filepath = path.join(rulesDir, item.file);
        const candidates = [
            ...(upstream[item.file] ? [upstream[item.file]] : []),
            ...mirrors.map(base => base.replace(/\/$/, '') + '/' + item.file)
        ];
        let downloaded = false;
        for (const url of candidates) {
            try {
                const data = await fetchBytes(url);
                if (!validateSrs(data)) throw new Error('Invalid SRS content');
                const old = fs.existsSync(filepath) ? fs.readFileSync(filepath) : null;
                if (!old || !old.equals(data)) atomicReplace(filepath, data);
                results[item.tag] = { status: old && old.equals(data) ? 'unchanged' : 'updated', source: new URL(url).host };
                downloaded = true;
                break;
            } catch (_) { /* next mirror */ }
        }
        if (!downloaded) {
            let cached = false;
            try { cached = validateSrs(fs.readFileSync(filepath)); } catch (_) {}
            results[item.tag] = { status: cached ? 'cached' : 'unavailable' };
        }
    }
    return results;
}
