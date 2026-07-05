// ==========================================
// subscription.js
// Módulo de gestión de suscripción para Arrow VPN.
//
// Responsabilidades:
//   - Descargar el contenido de una URL de suscripción
//   - Decodificar el base64
//   - Parsear cada línea vless:// a un objeto servidor estructurado
//   - Extraer metadatos de la suscripción (expiración, tráfico, título)
//   - Cifrar/descifrar la URL de suscripción con safeStorage
//
// NO toca sing-box ni la red. Solo datos.
// ==========================================

const { safeStorage } = require('electron');

// --------------------------------------------------
// Cifrado del link con safeStorage (clave del equipo)
// --------------------------------------------------
//
// safeStorage usa DPAPI en Windows, ligado al usuario de Windows.
// El link cifrado SOLO se puede descifrar en este equipo/usuario.
// Devolvemos base64 para poder guardarlo como string en electron-store.

function cifrarSubUrl(subUrl) {
    if (!safeStorage.isEncryptionAvailable()) {
        // Fallback: si por alguna razón no hay cifrado disponible
        // (raro en Windows), marcamos con prefijo plano para no romper.
        return 'plain:' + subUrl;
    }
    const buffer = safeStorage.encryptString(subUrl);
    return 'enc:' + buffer.toString('base64');
}

function descifrarSubUrl(almacenado) {
    if (!almacenado) return '';

    if (almacenado.startsWith('plain:')) {
        return almacenado.slice('plain:'.length);
    }

    if (almacenado.startsWith('enc:')) {
        if (!safeStorage.isEncryptionAvailable()) {
            return '';
        }
        try {
            const b64 = almacenado.slice('enc:'.length);
            const buffer = Buffer.from(b64, 'base64');
            return safeStorage.decryptString(buffer);
        } catch (e) {
            return '';
        }
    }

    // Compatibilidad: si viene sin prefijo, asumimos plano
    return almacenado;
}

// --------------------------------------------------
// Extracción de ISO de país desde emoji de bandera
// --------------------------------------------------
//
// Un emoji de bandera son 2 "Regional Indicator Symbols".
// Cada símbolo está en el rango U+1F1E6 (A) .. U+1F1FF (Z).
// Restando el offset obtenemos la letra. 🇳🇱 -> "NL".

function isoDesdeBandera(texto) {
    if (!texto) return null;

    const codepoints = [...texto];
    const letras = [];

    for (const ch of codepoints) {
        const cp = ch.codePointAt(0);
        if (cp >= 0x1F1E6 && cp <= 0x1F1FF) {
            letras.push(String.fromCharCode(65 + (cp - 0x1F1E6)));
            if (letras.length === 2) break;
        }
    }

    if (letras.length === 2) {
        return letras.join('');
    }
    return null;
}

// Extrae solo el emoji de bandera (los primeros 2 regional indicators)
function extraerEmojiBandera(texto) {
    if (!texto) return '';

    const codepoints = [...texto];
    const emoji = [];

    for (const ch of codepoints) {
        const cp = ch.codePointAt(0);
        if (cp >= 0x1F1E6 && cp <= 0x1F1FF) {
            emoji.push(ch);
            if (emoji.length === 2) break;
        }
    }

    return emoji.join('');
}

// --------------------------------------------------
// Parseo del nombre del servidor
// --------------------------------------------------
//
// Formato observado: "🇳🇱 Netherlands | Нидерланды"
// Devolvemos: { emoji, iso, nombreEN, nombreRU, nombreLimpio }

function parsearNombreServidor(fragment) {
    const texto = (fragment || '').trim();

    const emoji = extraerEmojiBandera(texto);
    const iso = isoDesdeBandera(texto) || 'UN';

    // Quitar el emoji del texto para quedarnos con los nombres
    let sinEmoji = texto;
    if (emoji) {
        sinEmoji = texto.replace(emoji, '').trim();
    } else {
        // Quitar cualquier regional indicator suelto
        sinEmoji = [...texto]
            .filter(ch => {
                const cp = ch.codePointAt(0);
                return !(cp >= 0x1F1E6 && cp <= 0x1F1FF);
            })
            .join('')
            .trim();
    }

    // Separar por "|" si existe (EN | RU)
    let nombreEN = sinEmoji;
    let nombreRU = sinEmoji;

    if (sinEmoji.includes('|')) {
        const partes = sinEmoji.split('|').map(s => s.trim());
        nombreEN = partes[0] || sinEmoji;
        nombreRU = partes[1] || partes[0] || sinEmoji;
    }

    return {
        emoji,
        iso,
        nombreEN,
        nombreRU,
        nombreLimpio: nombreEN,
    };
}

// --------------------------------------------------
// Parseo de una línea vless:// a objeto servidor
// --------------------------------------------------

function parsearLineaVless(linea) {
    const url = linea.trim();
    if (!url.startsWith('vless://')) return null;

    let parsed;
    try {
        parsed = new URL(url);
    } catch (e) {
        return null;
    }

    // El fragment (#...) es el nombre, viene URL-encoded
    let fragment = '';
    try {
        fragment = decodeURIComponent(parsed.hash.replace(/^#/, ''));
    } catch (e) {
        fragment = parsed.hash.replace(/^#/, '');
    }

    const meta = parsearNombreServidor(fragment);

    // ID estable del servidor: usamos el host (nl.arrow-x.org -> "nl")
    // Si el host no tiene subdominio reconocible, usamos el host completo.
    const host = parsed.hostname;
    let id = host;
    const primerLabel = host.split('.')[0];
    if (primerLabel && primerLabel.length <= 5) {
        id = primerLabel; // "nl", "at", "us", etc.
    }

    return {
        id,
        vless: url,
        host,
        port: parseInt(parsed.port || '443', 10),
        emoji: meta.emoji,
        iso: meta.iso,
        nombre: meta.nombreLimpio,
        nombreEN: meta.nombreEN,
        nombreRU: meta.nombreRU,
    };
}

// --------------------------------------------------
// Parseo del cuerpo completo de la suscripción
// --------------------------------------------------
//
// El cuerpo viene en base64. Al decodificar son N líneas vless://.
// Algunos paneles devuelven el cuerpo SIN base64 (texto plano con
// las líneas directas). Detectamos ambos casos.

function parsearCuerpoSuscripcion(cuerpoRaw) {
    let texto = (cuerpoRaw || '').trim();

    // ¿Es base64? Heurística: si NO contiene "vless://" pero al
    // decodificar como base64 sí aparece, entonces estaba en base64.
    if (!texto.includes('vless://')) {
        try {
            const decodificado = Buffer.from(texto, 'base64').toString('utf8');
            if (decodificado.includes('vless://')) {
                texto = decodificado;
            }
        } catch (e) {
            // no era base64, seguimos con el texto original
        }
    }

    const lineas = texto
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.startsWith('vless://'));

    const servidores = [];
    for (const linea of lineas) {
        const srv = parsearLineaVless(linea);
        if (srv) servidores.push(srv);
    }

    return servidores;
}

// --------------------------------------------------
// Parseo del header subscription-userinfo
// --------------------------------------------------
//
// Formato: "upload=0; download=227964165; total=0; expire=0"
// expire es timestamp Unix en segundos (0 = sin expiración)

function parsearUserinfo(headerValue) {
    const info = {
        upload: 0,
        download: 0,
        total: 0,
        expire: 0,
    };

    if (!headerValue) return info;

    const partes = headerValue.split(';');
    for (const parte of partes) {
        const [k, v] = parte.split('=').map(s => (s || '').trim());
        if (k && v !== undefined && k in info) {
            const num = parseInt(v, 10);
            if (!isNaN(num)) info[k] = num;
        }
    }

    return info;
}

// --------------------------------------------------
// Decodificar profile-title (puede venir "base64:...")
// --------------------------------------------------

function decodificarTitulo(headerValue) {
    if (!headerValue) return 'Arrow VPN';

    if (headerValue.startsWith('base64:')) {
        try {
            const b64 = headerValue.slice('base64:'.length);
            return Buffer.from(b64, 'base64').toString('utf8');
        } catch (e) {
            return 'Arrow VPN';
        }
    }

    return headerValue;
}

// --------------------------------------------------
// Fetch + parse completo de una suscripción
// --------------------------------------------------
//
// Devuelve:
//   {
//     ok: true/false,
//     servidores: [...],
//     expira: <timestamp Unix s o 0>,
//     trafico: { upload, download, total },
//     titulo: "Arrow VPN",
//     updateInterval: <horas>,
//     error: "..." (si ok=false)
//   }

async function obtenerSuscripcion(subUrl, timeoutMs = 12000) {
    if (!subUrl || !/^https?:\/\//i.test(subUrl)) {
        return { ok: false, error: 'invalid_url', servidores: [] };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let resp;
    try {
        resp = await fetch(subUrl, {
            signal: controller.signal,
            headers: {
                // Algunos paneles devuelven distinto contenido según UA;
                // nos identificamos como un cliente genérico compatible.
                'User-Agent': 'ArrowVPN/2.1 (sing-box; compatible)',
            },
        });
    } catch (e) {
        clearTimeout(timeoutId);
        return {
            ok: false,
            error: e.name === 'AbortError' ? 'timeout' : 'network',
            servidores: [],
        };
    }

    clearTimeout(timeoutId);

    if (!resp.ok) {
        return {
            ok: false,
            error: `http_${resp.status}`,
            servidores: [],
        };
    }

    const cuerpo = await resp.text();
    const servidores = parsearCuerpoSuscripcion(cuerpo);

    if (servidores.length === 0) {
        return {
            ok: false,
            error: 'no_servers',
            servidores: [],
        };
    }

    const userinfo = parsearUserinfo(resp.headers.get('subscription-userinfo'));
    const titulo = decodificarTitulo(resp.headers.get('profile-title'));
    const updateInterval = parseInt(
        resp.headers.get('profile-update-interval') || '12',
        10
    );

    return {
        ok: true,
        servidores,
        expira: userinfo.expire,
        trafico: {
            upload: userinfo.upload,
            download: userinfo.download,
            total: userinfo.total,
        },
        titulo,
        updateInterval: isNaN(updateInterval) ? 12 : updateInterval,
    };
}

module.exports = {
    cifrarSubUrl,
    descifrarSubUrl,
    obtenerSuscripcion,
    parsearCuerpoSuscripcion,
    parsearLineaVless,
    parsearNombreServidor,
    parsearUserinfo,
    decodificarTitulo,
    isoDesdeBandera,
    extraerEmojiBandera,
};
