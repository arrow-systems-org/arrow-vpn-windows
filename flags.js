// ==========================================
// flags.js
// Gestión de banderas SVG con cascada de fallback.
//
// Cascada de resolución para cada ISO:
//   1. Cache en appData/banderas/<iso>.svg  → usar
//   2. No está → descargar de arrow-x.org/banderas/<iso>.svg → guardar en cache
//   3. Descarga falla → copiar de las empaquetadas bin/banderas/<iso>.svg
//   4. No hay empaquetada → null (la UI muestra placeholder con ISO)
//
// La idea: las banderas de países conocidos vienen empaquetadas con la
// app (bin/banderas), así que nunca se ve blanco. Países nuevos se
// descargan la primera vez y quedan cacheados.
// ==========================================

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const BASE_URL_BANDERAS = 'https://arrow-x.org/banderas';

// Carpeta de cache en appData (escribible)
function dirCache() {
    const dir = path.join(app.getPath('userData'), 'banderas');
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch (e) {}
    return dir;
}

// Carpeta de banderas empaquetadas con la app (read-only).
// Va junto al resto de binarios desempaquetados (asarUnpack: bin/**/*).
function dirEmpaquetadas() {
    const rutaBin = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', 'banderas')
        : path.join(__dirname, 'bin', 'banderas');
    return rutaBin;
}

function rutaCache(iso) {
    return path.join(dirCache(), `${iso}.svg`);
}

function rutaEmpaquetada(iso) {
    return path.join(dirEmpaquetadas(), `${iso}.svg`);
}

// Validación mínima: que el contenido parezca un SVG y no una página
// de error HTML del servidor (evita cachear basura).
function pareceSvgValido(texto) {
    if (!texto) return false;
    const t = texto.trim().slice(0, 200).toLowerCase();
    return t.includes('<svg') || t.startsWith('<?xml');
}

// Descarga un SVG y lo guarda en cache. Devuelve true/false.
async function descargarYGuardar(iso, timeoutMs = 6000) {
    const url = `${BASE_URL_BANDERAS}/${iso}.svg`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!resp.ok) return false;

        const texto = await resp.text();
        if (!pareceSvgValido(texto)) return false;

        fs.writeFileSync(rutaCache(iso), texto, 'utf8');
        return true;
    } catch (e) {
        clearTimeout(timeoutId);
        return false;
    }
}

// Copia la bandera empaquetada al cache (para que futuras lecturas
// salgan del cache uniforme). Devuelve true/false.
function copiarEmpaquetadaACache(iso) {
    try {
        const origen = rutaEmpaquetada(iso);
        if (fs.existsSync(origen)) {
            fs.copyFileSync(origen, rutaCache(iso));
            return true;
        }
    } catch (e) {}
    return false;
}

// ==========================================
// Resolver UNA bandera. Devuelve la ruta local absoluta o null.
// ==========================================
async function resolverBandera(isoRaw) {
    const iso = String(isoRaw || '').toLowerCase().trim();
    if (!iso || iso === 'un' || iso.length !== 2) {
        return null; // ISO inválido → placeholder
    }

    // 1. ¿Ya está en cache?
    const enCache = rutaCache(iso);
    if (fs.existsSync(enCache)) {
        return enCache;
    }

    // 2. Intentar descargar
    const descargada = await descargarYGuardar(iso);
    if (descargada) {
        return rutaCache(iso);
    }

    // 3. Fallback: empaquetada → copiar a cache y devolver
    if (copiarEmpaquetadaACache(iso)) {
        return rutaCache(iso);
    }

    // 3b. Si la empaquetada existe pero no se pudo copiar, devolver
    //     la ruta empaquetada directamente (read-only, pero sirve).
    const empaquetada = rutaEmpaquetada(iso);
    if (fs.existsSync(empaquetada)) {
        return empaquetada;
    }

    // 4. Nada → placeholder
    return null;
}

// ==========================================
// Sincroniza un set de ISOs. Para cada uno que falte en cache,
// intenta descargar (o copiar de empaquetadas).
// Llamar tras activar/refrescar suscripción.
//
// Devuelve un mapa { iso: rutaLocal|null }.
// ==========================================
async function sincronizarBanderas(listaIso) {
    const unicos = [...new Set(
        (listaIso || [])
            .map(s => String(s || '').toLowerCase().trim())
            .filter(s => s && s !== 'un' && s.length === 2)
    )];

    const resultado = {};

    await Promise.all(unicos.map(async (iso) => {
        try {
            resultado[iso] = await resolverBandera(iso);
        } catch (e) {
            resultado[iso] = null;
        }
    }));

    return resultado;
}

module.exports = {
    resolverBandera,
    sincronizarBanderas,
    dirCache,
    dirEmpaquetadas,
};
