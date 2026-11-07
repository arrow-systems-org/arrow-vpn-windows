/**
 * Arrow VPN — RU Direct for sing-box >= 1.14 / sing-box-lx.
 * Happ's `geosite:` and `geoip:` strings are NOT sing-box route fields since 1.12.
 * Rule-sets are optional (download/cache); explicit rules always work offline.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const RU_DOMAIN_SUFFIXES = Object.freeze([
    'ru', 'su', 'xn--p1ai',
    'vk.com', 'ok.ru', 'userapi.com', 'vk-cdn.net', 'vkuservideo.net',
    'yandex.com', 'yandex.net', 'yastatic.net',
    'ozon.com', 'ozonusercontent.com', '2gis.com', 'okko.tv',
    'boosty.to', 'donationalerts.com', 'rutube', 'timeweb.cloud', 'timeweb.com'
]);

export const RU_RULE_SETS = Object.freeze([
    { tag: 'arrow-geosite-ru', file: 'geosite-category-ru.srs' },
    { tag: 'arrow-geoip-ru', file: 'geoip-ru.srs' }
]);

/**
 * Verify format before referencing a local .srs; an HTML 404 would crash sing-box.
 * Format: ASCII 'SRS', 1-byte version, then zlib payload.
 */
export function looksLikeSrs(buffer) {
    return Boolean(buffer && buffer.length >= 12 && buffer.length <= 4 * 1024 * 1024 &&
        buffer[0] === 0x53 && buffer[1] === 0x52 && buffer[2] === 0x53 &&
        buffer[3] >= 1 && buffer[3] <= 10);
}

export function validateLocalSrs(buffer) {
    if (!looksLikeSrs(buffer)) return false;
    try {
        return zlib.inflateSync(buffer.subarray(4), { maxOutputLength: 32 * 1024 * 1024 }).length > 0;
    } catch (_) { return false; }
}

export function presentRuleSets(rulesDir) {
    return RU_RULE_SETS.filter(item => {
        try {
            const file = path.join(rulesDir, item.file);
            const st = fs.statSync(file);
            if (!st.isFile() || st.size < 12 || st.size > 4 * 1024 * 1024) return false;
            return validateLocalSrs(fs.readFileSync(file));
        } catch (_) { return false; }
    });
}

/**
 * Apply only at config generation; caller must keep settings immutable until
 * disconnect. Modifies the generated config (not the user's subscription).
 */
export function addRuDirectRouting(config, { enabled = false, rulesDir = '' } = {}) {
    if (!enabled) return { applied: false, available: [] };
    const available = rulesDir ? presentRuleSets(rulesDir) : [];
    const tags = new Set(available.map(item => item.tag));

    // DNS interception is crucial for Windows TUN: otherwise Windows resolves
    // sites before sing-box sees their names, and IP routing is incomplete.
    config.route.rules.unshift(
        { action: 'sniff', timeout: '1s' },
        { protocol: 'dns', action: 'hijack-dns' },
        { port: 53, action: 'hijack-dns' }
    );

    // Preserve original private-network and server-IP exemptions. Specific
    // names precede the geographic rules; unmatched traffic remains proxy.
    const directRules = [
        { domain_suffix: [...RU_DOMAIN_SUFFIXES], action: 'route', outbound: 'direct' }
    ];
    if (tags.has('arrow-geosite-ru')) {
        directRules.push({ rule_set: 'arrow-geosite-ru', action: 'route', outbound: 'direct' });
    }
    if (tags.has('arrow-geoip-ru')) {
        directRules.push({ rule_set: 'arrow-geoip-ru', action: 'route', outbound: 'direct' });
    }
    config.route.rules.push(...directRules);

    if (available.length) {
        config.route.rule_set = available.map(item => ({
            tag: item.tag, type: 'local', format: 'binary',
            path: path.join(rulesDir, item.file)
        }));
    }

    // RU domains use local resolver, non-RU DNS stays on existing proxy DoH.
    config.dns.rules = [
        { domain_suffix: [...RU_DOMAIN_SUFFIXES], action: 'route', server: 'dns-local' },
        ...(tags.has('arrow-geosite-ru') ? [{ rule_set: 'arrow-geosite-ru', action: 'route', server: 'dns-local' }] : [])
    ];
    return { applied: true, available: available.map(item => item.tag) };
}
