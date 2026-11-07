// Consultas paralelas de metadata OTA: no cambian el provider de electron-updater.
// La descarga final sigue siendo validada por electron-updater con SHA-512.
const MAX_MANIFEST_BYTES = 64 * 1024;

export function parseReleaseVersion(manifest) {
    if (typeof manifest !== 'string' || manifest.length > MAX_MANIFEST_BYTES) return null;
    const line = manifest.match(/^version:\s*['"]?([^\s'"#]+)['"]?\s*(?:#.*)?$/m);
    if (!line) return null;
    return parseSemver(line[1]) ? line[1].replace(/^v/, '') : null;
}

function parseSemver(version) {
    const match = String(version).match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
    if (!match) return null;
    return {
        major: BigInt(match[1]), minor: BigInt(match[2]), patch: BigInt(match[3]),
        prerelease: match[4] ? match[4].split('.') : [],
    };
}

// Retorna -1, 0 o 1; admite versiones beta sin tratarlas como más recientes
// que la misma versión estable (reglas relevantes de SemVer).
export function compareReleaseVersions(a, b) {
    const av = parseSemver(a);
    const bv = parseSemver(b);
    if (!av || !bv) throw new Error('Invalid release version');
    for (const field of ['major', 'minor', 'patch']) {
        if (av[field] !== bv[field]) return av[field] > bv[field] ? 1 : -1;
    }
    const x = av.prerelease, y = bv.prerelease;
    if (x.length === 0 || y.length === 0) {
        return x.length === y.length ? 0 : (x.length === 0 ? 1 : -1);
    }
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if (i >= x.length) return -1;
        if (i >= y.length) return 1;
        if (x[i] === y[i]) continue;
        const nx = /^\d+$/.test(x[i]);
        const ny = /^\d+$/.test(y[i]);
        if (nx && ny) return BigInt(x[i]) > BigInt(y[i]) ? 1 : -1;
        if (nx !== ny) return nx ? -1 : 1;
        return x[i] > y[i] ? 1 : -1;
    }
    return 0;
}

export function rankMirrorCandidates(candidates) {
    return [...candidates].sort((a, b) =>
        compareReleaseVersions(b.version, a.version) || a.elapsedMs - b.elapsedMs || a.index - b.index
    );
}

async function limitedBody(response) {
    const contentLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_MANIFEST_BYTES) {
        throw new Error('Manifest too large');
    }
    if (!response.body?.getReader) {
        const text = await response.text();
        if (text.length > MAX_MANIFEST_BYTES) throw new Error('Manifest too large');
        return text;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > MAX_MANIFEST_BYTES) throw new Error('Manifest too large');
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks).toString('utf8');
}

export async function lookupLatestInMirrors(sources, {
    fetchImpl = globalThis.fetch,
    timeoutMs = 6000,
    clock = () => Date.now(),
} = {}) {
    // Hay mirrors que pueden responder con una versión vieja y HTTP 200.
    // Se consultan todos en paralelo, y luego gana la versión MAYOR; si hay
    // empate, gana el mirror que respondió más rápido.
    const outcomes = await Promise.all(sources.map(async (source, index) => {
        const started = clock();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const target = `${source.url.replace(/\/$/, '')}/latest.yml`;
            if (new URL(target).protocol !== 'https:') throw new Error('Non-HTTPS OTA source');
            const response = await fetchImpl(target, {
                method: 'GET', redirect: 'follow', signal: controller.signal,
                headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            if (response.url && new URL(response.url).protocol !== 'https:') throw new Error('Insecure redirect');
            const version = parseReleaseVersion(await limitedBody(response));
            if (!version) throw new Error('Invalid latest.yml version');
            return { ok: true, id: source.id, index, version, elapsedMs: Math.max(0, clock() - started) };
        } catch (error) {
            return { ok: false, id: source.id, index, error: error?.name === 'AbortError' ? 'Timeout' : String(error?.message || error) };
        } finally {
            clearTimeout(timeout);
        }
    }));
    const candidates = rankMirrorCandidates(outcomes.filter(x => x.ok));
    return { candidates, errors: outcomes.filter(x => !x.ok) };
}
