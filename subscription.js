// subscription.js — privacy-first subscription/source manager.
// Parsing is provider-agnostic: Arrow VPN gets first-class metadata, but the
// client can consume compatible third-party subscriptions or single share links.

import { safeStorage } from 'electron';
import {
    parseNodeUri,
    parseSubscriptionText,
    parsearNombreServidor,
    isoDesdeBandera,
    extraerEmojiBandera,
    canonicalSupportedSchemes
} from './protocols.js';

function cifrarSecreto(value) {
    const text = String(value ?? '');
    if (!text) return '';
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('secure_storage_unavailable');
    }
    return 'enc:' + safeStorage.encryptString(text).toString('base64');
}

function descifrarSecreto(stored) {
    if (!stored) return '';
    const value = String(stored);
    if (value.startsWith('enc:')) {
        if (!safeStorage.isEncryptionAvailable()) return '';
        try {
            return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'));
        } catch {
            return '';
        }
    }
    // Read-only migration path for <=3.0.2. New writes never use plaintext.
    if (value.startsWith('plain:')) return value.slice(6);
    return value;
}

const cifrarSubUrl = cifrarSecreto;
const descifrarSubUrl = descifrarSecreto;

function cifrarServidores(servidores) {
    return cifrarSecreto(JSON.stringify(servidores || {}));
}

function descifrarServidores(stored) {
    const json = descifrarSecreto(stored);
    if (!json) return {};
    try {
        const obj = JSON.parse(json);
        return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
    } catch {
        return {};
    }
}

function parsearLineaVless(linea) {
    const node = parseNodeUri(linea);
    return node?.protocol === 'vless' ? node : null;
}

function parsearCuerpoSuscripcion(cuerpoRaw) {
    return parseSubscriptionText(cuerpoRaw);
}

function parsearUserinfo(headerValue) {
    const info = { upload: 0, download: 0, total: 0, expire: 0 };
    if (!headerValue) return info;
    for (const part of String(headerValue).split(';')) {
        const [k, v] = part.split('=').map(s => (s || '').trim());
        if (k && v !== undefined && Object.hasOwn(info, k)) {
            const n = Number.parseInt(v, 10);
            if (Number.isFinite(n)) info[k] = n;
        }
    }
    return info;
}

function decodificarTitulo(headerValue) {
    if (!headerValue) return 'VPN Subscription';
    const value = String(headerValue);
    if (value.startsWith('base64:')) {
        try { return Buffer.from(value.slice(7), 'base64').toString('utf8'); }
        catch { return 'VPN Subscription'; }
    }
    return value;
}

function isShareLink(value) {
    const scheme = String(value || '').trim().match(/^([a-zA-Z0-9+.-]+):\/\//)?.[1]?.toLowerCase();
    return Boolean(scheme && canonicalSupportedSchemes().includes(scheme));
}

async function obtenerSuscripcion(source, timeoutMs = 12000) {
    const input = String(source || '').trim();
    if (!input) return { ok: false, error: 'invalid_url', servidores: [] };

    // A single imported node never leaves the device.
    if (isShareLink(input)) {
        const node = parseNodeUri(input);
        if (!node) return { ok: false, error: 'no_servers', servidores: [] };
        return {
            ok: true,
            servidores: [node],
            expira: 0,
            trafico: { upload: 0, download: 0, total: 0 },
            titulo: 'Imported node',
            updateInterval: 0,
            sourceType: 'single-node'
        };
    }

    let parsed;
    try { parsed = new URL(input); } catch { return { ok: false, error: 'invalid_url', servidores: [] }; }
    if (parsed.protocol !== 'https:') {
        return { ok: false, error: 'insecure_url', servidores: [] };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let resp;
    try {
        resp = await fetch(input, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': 'ArrowVPN/3.1 (sing-box-lx; subscription-compatible)',
                'Accept': 'text/plain, application/octet-stream, */*'
            }
        });
    } catch (e) {
        clearTimeout(timeoutId);
        return { ok: false, error: e.name === 'AbortError' ? 'timeout' : 'network', servidores: [] };
    }
    clearTimeout(timeoutId);

    // A redirect must not silently downgrade an HTTPS subscription to plaintext HTTP.
    try {
        if (new URL(resp.url).protocol !== 'https:') {
            return { ok: false, error: 'insecure_url', servidores: [] };
        }
    } catch {
        return { ok: false, error: 'invalid_url', servidores: [] };
    }

    if (!resp.ok) return { ok: false, error: `http_${resp.status}`, servidores: [] };

    // Subscriptions are line-oriented and normally tiny. Cap the response to avoid
    // a malicious or broken provider making the Electron main process hold huge blobs.
    const MAX_SUBSCRIPTION_BYTES = 5 * 1024 * 1024;
    const contentLength = Number.parseInt(resp.headers.get('content-length') || '0', 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_SUBSCRIPTION_BYTES) {
        return { ok: false, error: 'too_large', servidores: [] };
    }
    const body = await resp.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_SUBSCRIPTION_BYTES) {
        return { ok: false, error: 'too_large', servidores: [] };
    }
    const servidores = parseSubscriptionText(body);
    if (!servidores.length) return { ok: false, error: 'no_servers', servidores: [] };

    const userinfo = parsearUserinfo(resp.headers.get('subscription-userinfo'));
    const titleHeader = resp.headers.get('profile-title');
    const titulo = decodificarTitulo(titleHeader || parsed.hostname || 'VPN Subscription');
    const updateIntervalRaw = Number.parseInt(resp.headers.get('profile-update-interval') || '12', 10);

    return {
        ok: true,
        servidores,
        expira: userinfo.expire,
        trafico: { upload: userinfo.upload, download: userinfo.download, total: userinfo.total },
        titulo,
        updateInterval: Number.isFinite(updateIntervalRaw) ? updateIntervalRaw : 12,
        sourceType: /(^|\.)arrow-x\.(org|com|biz)$/i.test(parsed.hostname) ? 'arrow' : 'external'
    };
}

export {
    cifrarSecreto,
    descifrarSecreto,
    cifrarSubUrl,
    descifrarSubUrl,
    cifrarServidores,
    descifrarServidores,
    obtenerSuscripcion,
    parsearCuerpoSuscripcion,
    parsearLineaVless,
    parsearNombreServidor,
    parsearUserinfo,
    decodificarTitulo,
    isoDesdeBandera,
    extraerEmojiBandera,
    isShareLink
};
