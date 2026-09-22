import crypto from 'node:crypto';

const SUPPORTED_SCHEMES = new Set(['vless', 'trojan', 'vmess', 'ss', 'hysteria2', 'hy2', 'tuic']);

function boolParam(value, defaultValue = false) {
    if (value === null || value === undefined || value === '') return defaultValue;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function intParam(value, fallback = undefined) {
    const n = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) ? n : fallback;
}

function safeDecode(text) {
    try { return decodeURIComponent(text); } catch { return text; }
}

function decodeBase64Flexible(input) {
    const normalized = String(input || '')
        .trim()
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    const pad = normalized.length % 4;
    const padded = normalized + (pad ? '='.repeat(4 - pad) : '');
    return Buffer.from(padded, 'base64').toString('utf8');
}

function stableNodeId(raw) {
    const withoutFragment = String(raw || '').replace(/#.*$/, '');
    return crypto.createHash('sha256').update(withoutFragment).digest('hex').slice(0, 16);
}

function isoDesdeBandera(texto) {
    if (!texto) return null;
    const letras = [];
    for (const ch of [...texto]) {
        const cp = ch.codePointAt(0);
        if (cp >= 0x1F1E6 && cp <= 0x1F1FF) {
            letras.push(String.fromCharCode(65 + cp - 0x1F1E6));
            if (letras.length === 2) break;
        }
    }
    return letras.length === 2 ? letras.join('') : null;
}

function extraerEmojiBandera(texto) {
    if (!texto) return '';
    const out = [];
    for (const ch of [...texto]) {
        const cp = ch.codePointAt(0);
        if (cp >= 0x1F1E6 && cp <= 0x1F1FF) {
            out.push(ch);
            if (out.length === 2) break;
        }
    }
    return out.join('');
}

function parsearNombreServidor(fragment) {
    const texto = String(fragment || '').trim();
    const emoji = extraerEmojiBandera(texto);
    const iso = isoDesdeBandera(texto) || 'UN';
    let sinEmoji = emoji ? texto.replace(emoji, '').trim() : texto;
    if (!emoji) {
        sinEmoji = [...texto].filter(ch => {
            const cp = ch.codePointAt(0);
            return !(cp >= 0x1F1E6 && cp <= 0x1F1FF);
        }).join('').trim();
    }
    let nombreEN = sinEmoji || 'Server';
    let nombreRU = nombreEN;
    if (sinEmoji.includes('|')) {
        const parts = sinEmoji.split('|').map(v => v.trim()).filter(Boolean);
        nombreEN = parts[0] || 'Server';
        nombreRU = parts[1] || nombreEN;
    }
    return { emoji, iso, nombre: nombreEN, nombreEN, nombreRU };
}

function metaFromFragment(rawFragment, fallbackName, protocol) {
    const decoded = safeDecode(String(rawFragment || '').replace(/^#/, ''));
    const meta = parsearNombreServidor(decoded || fallbackName || protocol.toUpperCase());
    return { ...meta, displayName: meta.nombre || fallbackName || protocol.toUpperCase() };
}

function getFirst(params, names, fallback = '') {
    for (const name of names) {
        const value = params.get(name);
        if (value !== null && value !== '') return value;
    }
    return fallback;
}

function parseExtraParam(params) {
    const raw = params.get('extra');
    if (!raw) return {};
    try {
        const decoded = safeDecode(raw);
        const obj = JSON.parse(decoded);
        return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch {
        return {};
    }
}

function normalizeXhttpExtra(extra) {
    if (!extra || typeof extra !== 'object') return {};
    const aliases = {
        mode: 'mode', host: 'host', path: 'path', headers: 'headers',
        xPaddingBytes: 'x_padding_bytes', x_padding_bytes: 'x_padding_bytes',
        noGRPCHeader: 'no_grpc_header', noGrpcHeader: 'no_grpc_header', no_grpc_header: 'no_grpc_header',
        sessionIDPlacement: 'session_placement', sessionIdPlacement: 'session_placement', session_placement: 'session_placement',
        sessionIDKey: 'session_key', sessionIdKey: 'session_key', session_key: 'session_key',
        sessionIDTable: 'session_table', sessionIdTable: 'session_table', session_table: 'session_table',
        sessionIDLength: 'session_length', sessionIdLength: 'session_length', session_length: 'session_length',
        seqPlacement: 'seq_placement', seq_placement: 'seq_placement',
        seqKey: 'seq_key', seq_key: 'seq_key',
        uplinkDataPlacement: 'uplink_data_placement', uplink_data_placement: 'uplink_data_placement',
        uplinkDataKey: 'uplink_data_key', uplink_data_key: 'uplink_data_key',
        uplinkChunkSize: 'uplink_chunk_size', uplink_chunk_size: 'uplink_chunk_size',
        uplinkHTTPMethod: 'uplink_http_method', uplinkHttpMethod: 'uplink_http_method', uplink_http_method: 'uplink_http_method',
        xPaddingObfsMode: 'x_padding_obfs_mode', x_padding_obfs_mode: 'x_padding_obfs_mode',
        xPaddingPlacement: 'x_padding_placement', x_padding_placement: 'x_padding_placement',
        xPaddingKey: 'x_padding_key', x_padding_key: 'x_padding_key',
        xPaddingHeader: 'x_padding_header', x_padding_header: 'x_padding_header',
        xPaddingMethod: 'x_padding_method', x_padding_method: 'x_padding_method',
        scMaxEachPostBytes: 'sc_max_each_post_bytes', sc_max_each_post_bytes: 'sc_max_each_post_bytes',
        scMinPostsIntervalMs: 'sc_min_posts_interval_ms', sc_min_posts_interval_ms: 'sc_min_posts_interval_ms',
        scMaxConcurrentPosts: 'sc_max_concurrent_posts', sc_max_concurrent_posts: 'sc_max_concurrent_posts',
        serverMaxHeaderBytes: 'server_max_header_bytes', server_max_header_bytes: 'server_max_header_bytes',
        noSSEHeader: 'no_sse_header', no_sse_header: 'no_sse_header',
        scMaxBufferedPosts: 'sc_max_buffered_posts', sc_max_buffered_posts: 'sc_max_buffered_posts',
        scStreamUpServerSecs: 'sc_stream_up_server_secs', sc_stream_up_server_secs: 'sc_stream_up_server_secs',
        xmux: 'xmux'
    };
    const out = {};
    for (const [key, value] of Object.entries(extra)) {
        const mapped = aliases[key];
        if (!mapped || value === '' || value === null || value === undefined) continue;
        if (mapped === 'xmux' && typeof value === 'object' && !Array.isArray(value)) {
            const xmuxAliases = {
                maxConcurrency: 'max_concurrency', max_concurrency: 'max_concurrency',
                maxConnections: 'max_connections', max_connections: 'max_connections',
                cMaxReuseTimes: 'c_max_reuse_times', c_max_reuse_times: 'c_max_reuse_times',
                hMaxRequestTimes: 'h_max_request_times', h_max_request_times: 'h_max_request_times',
                hMaxReusableSecs: 'h_max_reusable_secs', h_max_reusable_secs: 'h_max_reusable_secs',
                hKeepAlivePeriod: 'h_keep_alive_period', h_keep_alive_period: 'h_keep_alive_period'
            };
            const x = {};
            for (const [xk, xv] of Object.entries(value)) {
                const mk = xmuxAliases[xk];
                if (mk && xv !== '' && xv !== null && xv !== undefined) x[mk] = xv;
            }
            if (Object.keys(x).length) out.xmux = x;
        } else {
            out[mapped] = value;
        }
    }
    return out;
}

function commonUrlNode(raw, parsed, protocol, defaultPort) {
    const fragment = parsed.hash.replace(/^#/, '');
    const fallbackName = parsed.hostname || protocol.toUpperCase();
    const meta = metaFromFragment(fragment, fallbackName, protocol);
    return {
        id: stableNodeId(raw),
        raw,
        protocol,
        host: parsed.hostname,
        port: intParam(parsed.port, defaultPort),
        ...meta
    };
}

function parseVless(raw) {
    const u = new URL(raw);
    if (!u.username || !u.hostname) throw new Error('invalid_vless');
    return { ...commonUrlNode(raw, u, 'vless', 443), uuid: safeDecode(u.username), params: Object.fromEntries(u.searchParams) };
}

function parseTrojan(raw) {
    const u = new URL(raw);
    if (!u.username || !u.hostname) throw new Error('invalid_trojan');
    return { ...commonUrlNode(raw, u, 'trojan', 443), password: safeDecode(u.username), params: Object.fromEntries(u.searchParams) };
}

function parseHysteria2(raw) {
    const normalized = raw.replace(/^hy2:/i, 'hysteria2:');
    const u = new URL(normalized);
    if (!u.username || !u.hostname) throw new Error('invalid_hysteria2');
    return { ...commonUrlNode(raw, u, 'hysteria2', 443), password: safeDecode(u.username), params: Object.fromEntries(u.searchParams) };
}

function parseTuic(raw) {
    const u = new URL(raw);
    if (!u.username || !u.hostname) throw new Error('invalid_tuic');
    return {
        ...commonUrlNode(raw, u, 'tuic', 443),
        uuid: safeDecode(u.username),
        password: safeDecode(u.password),
        params: Object.fromEntries(u.searchParams)
    };
}

function parseVmess(raw) {
    const payload = raw.slice('vmess://'.length).split('#')[0];
    const obj = JSON.parse(decodeBase64Flexible(payload));
    if (!obj.add || !obj.id) throw new Error('invalid_vmess');
    const fragmentMatch = raw.match(/#(.*)$/);
    const fragment = fragmentMatch ? fragmentMatch[1] : (obj.ps || 'VMess');
    const meta = metaFromFragment(fragment, obj.ps || obj.add, 'vmess');
    return {
        id: stableNodeId(raw), raw, protocol: 'vmess', host: String(obj.add),
        port: intParam(obj.port, 443), uuid: String(obj.id), vmess: obj, ...meta
    };
}

function parseShadowsocks(raw) {
    const fragment = (raw.match(/#(.*)$/) || [])[1] || '';
    const noFragment = raw.replace(/#.*$/, '');
    const body = noFragment.slice('ss://'.length);
    const meta = metaFromFragment(fragment, 'Shadowsocks', 'ss');

    let method = '', password = '', host = '', port = 0, plugin = '', pluginOpts = '';
    if (body.includes('@')) {
        const at = body.lastIndexOf('@');
        const userPart = body.slice(0, at);
        const serverPart = body.slice(at + 1);
        const creds = userPart.includes(':') ? safeDecode(userPart) : decodeBase64Flexible(userPart);
        const colon = creds.indexOf(':');
        if (colon < 1) throw new Error('invalid_ss');
        method = creds.slice(0, colon);
        password = creds.slice(colon + 1);
        const u = new URL(`ss://${method}:${encodeURIComponent(password)}@${serverPart}`);
        host = u.hostname;
        port = intParam(u.port, 8388);
        plugin = u.searchParams.get('plugin') || '';
    } else {
        const decoded = decodeBase64Flexible(body.split('?')[0]);
        const m = decoded.match(/^([^:]+):(.+)@\[?([^\]]+)\]?:([0-9]+)$/);
        if (!m) throw new Error('invalid_ss');
        [, method, password, host] = m;
        port = intParam(m[4], 8388);
    }
    if (plugin) {
        const [p, ...opts] = safeDecode(plugin).split(';');
        plugin = p;
        pluginOpts = opts.join(';');
    }
    return { id: stableNodeId(raw), raw, protocol: 'ss', host, port, method, password, plugin, pluginOpts, ...meta };
}

function parseNodeUri(rawInput) {
    const raw = String(rawInput || '').trim();
    const m = raw.match(/^([a-zA-Z0-9+.-]+):\/\//);
    if (!m) return null;
    const scheme = m[1].toLowerCase();
    if (!SUPPORTED_SCHEMES.has(scheme)) return null;
    try {
        switch (scheme) {
            case 'vless': return parseVless(raw);
            case 'trojan': return parseTrojan(raw);
            case 'vmess': return parseVmess(raw);
            case 'ss': return parseShadowsocks(raw);
            case 'hysteria2':
            case 'hy2': return parseHysteria2(raw);
            case 'tuic': return parseTuic(raw);
            default: return null;
        }
    } catch {
        return null;
    }
}

function parseSubscriptionText(rawText) {
    let text = String(rawText || '').trim();
    if (!text) return [];
    const containsScheme = /(?:^|\s)(?:vless|trojan|vmess|ss|hysteria2|hy2|tuic):\/\//im.test(text);
    if (!containsScheme) {
        try {
            const decoded = decodeBase64Flexible(text);
            if (/(?:vless|trojan|vmess|ss|hysteria2|hy2|tuic):\/\//i.test(decoded)) text = decoded;
        } catch {}
    }
    const candidates = text.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
    const nodes = [];
    const seen = new Set();
    for (const line of candidates) {
        const node = parseNodeUri(line);
        if (!node || seen.has(node.id)) continue;
        seen.add(node.id);
        nodes.push(node);
    }
    return nodes;
}

function tlsFromParams(params, host, securityOverride = '') {
    const security = (securityOverride || getFirst(params, ['security'], '')).toLowerCase();
    if (!['tls', 'reality'].includes(security)) return undefined;
    const serverName = getFirst(params, ['sni', 'serverName', 'peer'], host);
    const tls = {
        enabled: true,
        server_name: serverName,
        insecure: boolParam(getFirst(params, ['allowInsecure', 'insecure'], '0')),
        utls: { enabled: true, fingerprint: getFirst(params, ['fp', 'fingerprint'], 'chrome') }
    };
    const alpn = getFirst(params, ['alpn']);
    if (alpn) tls.alpn = alpn.split(',').map(v => v.trim()).filter(Boolean);
    if (boolParam(getFirst(params, ['fragment'], '0'))) tls.fragment = true;
    if (boolParam(getFirst(params, ['record_fragment', 'recordFragment'], '0'))) tls.record_fragment = true;
    if (security === 'reality') {
        tls.reality = {
            enabled: true,
            public_key: getFirst(params, ['pbk', 'publicKey', 'public_key']),
            short_id: getFirst(params, ['sid', 'shortId', 'short_id'], '')
        };
        const keyShare = getFirst(params, ['key_share', 'keyShare']);
        if (keyShare) tls.reality.key_share = keyShare;
    }
    return tls;
}

function buildXhttpTransport(params, hostFallback) {
    const extra = normalizeXhttpExtra(parseExtraParam(params));
    const out = { type: 'xhttp' };
    const direct = {
        mode: getFirst(params, ['mode']),
        host: getFirst(params, ['host']),
        path: getFirst(params, ['path']),
        x_padding_bytes: getFirst(params, ['x_padding_bytes', 'xPaddingBytes'])
    };
    Object.assign(out, extra);
    for (const [k, v] of Object.entries(direct)) if (v !== '') out[k] = v;
    if (!Object.hasOwn(out, 'mode')) out.mode = 'auto';
    if (!Object.hasOwn(out, 'path')) out.path = '/';
    if (!Object.hasOwn(out, 'host') && getFirst(params, ['host'])) out.host = getFirst(params, ['host']);
    if (!Object.hasOwn(out, 'x_padding_bytes')) out.x_padding_bytes = '100-1000';
    if (out.host === '') delete out.host;
    if (!out.host && hostFallback && boolParam(params.get('forceHost'))) out.host = hostFallback;
    return out;
}

function buildV2RayTransport(params, hostFallback) {
    const type = getFirst(params, ['type', 'network'], 'tcp').toLowerCase();
    if (['tcp', 'raw', 'none'].includes(type)) return undefined;
    if (type === 'ws' || type === 'websocket') {
        const host = getFirst(params, ['host']);
        const transport = { type: 'ws', path: getFirst(params, ['path'], '/') };
        if (host) transport.headers = { Host: host };
        return transport;
    }
    if (type === 'grpc') {
        const transport = { type: 'grpc' };
        const serviceName = getFirst(params, ['serviceName', 'service_name']);
        if (serviceName) transport.service_name = serviceName;
        return transport;
    }
    if (type === 'httpupgrade') {
        const transport = { type: 'httpupgrade', path: getFirst(params, ['path'], '/') };
        const host = getFirst(params, ['host']);
        if (host) transport.host = host;
        return transport;
    }
    if (type === 'xhttp' || type === 'splithttp') return buildXhttpTransport(params, hostFallback);
    return undefined;
}

function parseParamsFromRaw(raw) {
    const u = new URL(raw.replace(/^hy2:/i, 'hysteria2:'));
    return { u, params: u.searchParams };
}

function buildVlessOutbound(node, server) {
    const { u, params } = parseParamsFromRaw(node.raw);
    const out = { type: 'vless', tag: 'proxy', server, server_port: node.port, uuid: safeDecode(u.username) };
    const flow = getFirst(params, ['flow']);
    if (flow) out.flow = flow;
    const encryption = getFirst(params, ['encryption']);
    if (encryption && encryption !== 'none') out.encryption = encryption;
    const tls = tlsFromParams(params, node.host);
    if (tls) out.tls = tls;
    const transport = buildV2RayTransport(params, tls?.server_name || node.host);
    if (transport) out.transport = transport;
    return out;
}

function buildTrojanOutbound(node, server) {
    const { u, params } = parseParamsFromRaw(node.raw);
    const out = { type: 'trojan', tag: 'proxy', server, server_port: node.port, password: safeDecode(u.username) };
    const tls = tlsFromParams(params, node.host, getFirst(params, ['security'], 'tls'));
    if (tls) out.tls = tls;
    const transport = buildV2RayTransport(params, tls?.server_name || node.host);
    if (transport) out.transport = transport;
    return out;
}

function buildVmessOutbound(node, server) {
    const v = node.vmess;
    const out = {
        type: 'vmess', tag: 'proxy', server, server_port: node.port, uuid: node.uuid,
        security: v.scy || v.security || 'auto', alter_id: intParam(v.aid, 0)
    };
    const pseudo = new URLSearchParams();
    if (v.net) pseudo.set('type', v.net);
    if (v.path) pseudo.set('path', v.path);
    if (v.host) pseudo.set('host', v.host);
    if (v.sni) pseudo.set('sni', v.sni);
    if (v.fp) pseudo.set('fp', v.fp);
    if (v.alpn) pseudo.set('alpn', v.alpn);
    if (v.tls) pseudo.set('security', v.tls === 'tls' ? 'tls' : v.tls);
    const tls = tlsFromParams(pseudo, node.host);
    if (tls) out.tls = tls;
    const transport = buildV2RayTransport(pseudo, tls?.server_name || node.host);
    if (transport) out.transport = transport;
    return out;
}

function buildShadowsocksOutbound(node, server) {
    const out = {
        type: 'shadowsocks', tag: 'proxy', server, server_port: node.port,
        method: node.method, password: node.password
    };
    if (node.plugin) {
        out.plugin = node.plugin;
        if (node.pluginOpts) out.plugin_opts = node.pluginOpts;
    }
    return out;
}

function buildHysteria2Outbound(node, server) {
    const { params } = parseParamsFromRaw(node.raw);
    const out = { type: 'hysteria2', tag: 'proxy', server, server_port: node.port, password: node.password };
    const up = intParam(getFirst(params, ['upmbps', 'up_mbps']));
    const down = intParam(getFirst(params, ['downmbps', 'down_mbps']));
    if (up) out.up_mbps = up;
    if (down) out.down_mbps = down;
    const obfsType = getFirst(params, ['obfs']);
    const obfsPassword = getFirst(params, ['obfs-password', 'obfs_password']);
    if (obfsType) out.obfs = { type: obfsType, password: obfsPassword };
    const sni = getFirst(params, ['sni', 'peer'], node.host);
    out.tls = { enabled: true, server_name: sni, insecure: boolParam(getFirst(params, ['insecure', 'allowInsecure'], '0')) };
    const alpn = getFirst(params, ['alpn']);
    if (alpn) out.tls.alpn = alpn.split(',').map(v => v.trim()).filter(Boolean);
    return out;
}

function buildTuicOutbound(node, server) {
    const { params } = parseParamsFromRaw(node.raw);
    const out = {
        type: 'tuic', tag: 'proxy', server, server_port: node.port,
        uuid: node.uuid, password: node.password,
        congestion_control: getFirst(params, ['congestion_control', 'congestion'], 'cubic'),
        udp_relay_mode: getFirst(params, ['udp_relay_mode', 'udpRelayMode'], 'native')
    };
    if (params.has('zero_rtt_handshake') || params.has('zeroRTT')) out.zero_rtt_handshake = boolParam(getFirst(params, ['zero_rtt_handshake', 'zeroRTT']));
    const heartbeat = getFirst(params, ['heartbeat']);
    if (heartbeat) out.heartbeat = heartbeat;
    out.tls = {
        enabled: true,
        server_name: getFirst(params, ['sni', 'peer'], node.host),
        insecure: boolParam(getFirst(params, ['insecure', 'allowInsecure'], '0')),
        alpn: [getFirst(params, ['alpn'], 'h3')]
    };
    return out;
}

function buildProxyOutbound(nodeOrRaw, serverOverride) {
    const node = typeof nodeOrRaw === 'string' ? parseNodeUri(nodeOrRaw) : nodeOrRaw;
    if (!node) throw new Error('unsupported_node');
    const server = serverOverride || node.host;
    switch (node.protocol) {
        case 'vless': return buildVlessOutbound(node, server);
        case 'trojan': return buildTrojanOutbound(node, server);
        case 'vmess': return buildVmessOutbound(node, server);
        case 'ss': return buildShadowsocksOutbound(node, server);
        case 'hysteria2': return buildHysteria2Outbound(node, server);
        case 'tuic': return buildTuicOutbound(node, server);
        default: throw new Error('unsupported_node');
    }
}

function isUdpNativeProtocol(nodeOrRaw) {
    const node = typeof nodeOrRaw === 'string' ? parseNodeUri(nodeOrRaw) : nodeOrRaw;
    return Boolean(node && ['hysteria2', 'tuic'].includes(node.protocol));
}

function sanitizeNode(node) {
    if (!node) return null;
    return {
        id: node.id,
        protocol: node.protocol,
        host: node.host,
        port: node.port,
        nombre: node.nombre,
        nombreEN: node.nombreEN,
        nombreRU: node.nombreRU,
        iso: node.iso,
        emoji: node.emoji,
        displayName: node.displayName
    };
}

function canonicalSupportedSchemes() {
    return ['vless', 'trojan', 'vmess', 'ss', 'hysteria2', 'hy2', 'tuic'];
}

export {
    stableNodeId,
    parseNodeUri,
    parseSubscriptionText,
    buildProxyOutbound,
    isUdpNativeProtocol,
    sanitizeNode,
    parsearNombreServidor,
    isoDesdeBandera,
    extraerEmojiBandera,
    canonicalSupportedSchemes
};
