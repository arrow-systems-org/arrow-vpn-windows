import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, session, clipboard } from 'electron';
import Store from 'electron-store';
import updaterPackage from 'electron-updater';
import log from 'electron-log/main';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawn, execSync, spawnSync } from 'node:child_process';
import * as os from 'node:os';
import * as net from 'node:net';
import { promises as dns } from 'node:dns';
import { fileURLToPath } from 'node:url';
import * as subscription from './subscription.js';
import * as protocols from './protocols.js';
import * as flags from './flags.js';

const { autoUpdater } = updaterPackage;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// CANDADO DE INSTANCIA ÚNICA
// Si ya hay una instancia abierta, esta se cierra inmediatamente.
// La instancia existente recibirá el evento 'second-instance' (más abajo)
// y traerá su ventana al frente con un aviso al usuario.
// ==========================================
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
    process.exit(0);
}

// ==========================================
// ============================================================
// SISTEMA ACTUALIZADOR OTA v3 (In-app modal + control manual)
// ============================================================
//
// Cambios respecto a la versión anterior:
//   - autoDownload=false, autoInstallOnAppQuit=false → control total
//   - electron-log para diagnóstico en cliente
//   - Interval de re-chequeo cada 1h (antes solo 3s al arranque)
//   - quitAndInstall(true, true) correcto (silent+restart)
//   - Handlers IPC: ota-check, ota-download, ota-install-restart
//   - Eventos emitidos al renderer: ota:available, ota:not-available,
//     ota:error, ota:progress, ota:downloaded
//
// El modal se renderiza en el renderer con tu estilo panel-flotante.


// Fuentes OTA resilientes. La app nunca depende de una IP/puerto concreto.
// Los tres primeros son mirrors del mismo release; arrow-updates.xyz queda
// como dominio independiente de emergencia.
const OTA_UPDATE_SOURCES = Object.freeze([
    { id: 'primary',   url: 'https://updates.arrow-x.org/windows/stable' },
    { id: 'russia',    url: 'https://updates.ru.arrow-x.com/windows/stable' },
    { id: 'github',    url: 'https://github.com/arrow-systems-org/arrow-vpn-windows/releases/latest/download' },
    { id: 'emergency', url: 'https://arrow-updates.xyz/windows/stable' },
]);
const OTA_SOURCE_TIMEOUT_MS = 15_000;

// Evitar caché del latest.yml.
autoUpdater.requestHeaders = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' };

// Control MANUAL del ciclo (no auto-download, no auto-install al cierre)
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

// Log completo a %APPDATA%\arrow-vpn\logs\main.log
log.transports.file.level = 'info';
log.transports.file.fileName = 'main.log';
autoUpdater.logger = log;
log.info('[OTA] logger inicializado. Version app:', app.getVersion());

// Referencias globales para el ciclo de update
let ota_updateInfo = null;       // { version, releaseDate, ... } cuando hay update
let ota_downloadInProgress = false;
let ota_downloaded = false;
let ota_activeSourceIndex = 0;
let ota_failoverActive = false;
let ota_silentProviderRefresh = false;

function configurarFuenteOta(index) {
    const safeIndex = Math.max(0, Math.min(index, OTA_UPDATE_SOURCES.length - 1));
    const source = OTA_UPDATE_SOURCES[safeIndex];
    autoUpdater.setFeedURL({
        provider: 'generic',
        url: source.url,
        timeout: OTA_SOURCE_TIMEOUT_MS,
        useMultipleRangeRequest: true,
    });
    ota_activeSourceIndex = safeIndex;
    log.info(`[OTA] fuente activa: ${source.id} (${source.url})`);
    return source;
}

function mensajeErrorOta(error) {
    return (error && error.message) ? error.message : String(error);
}

async function comprobarActualizacionConFailover(reason = 'manual', startIndex = 0) {
    const errors = [];
    ota_failoverActive = true;

    try {
        for (let offset = 0; offset < OTA_UPDATE_SOURCES.length; offset += 1) {
            const index = (startIndex + offset) % OTA_UPDATE_SOURCES.length;
            const source = configurarFuenteOta(index);

            try {
                log.info(`[OTA] comprobando ${source.id}; reason=${reason}`);
                const result = await autoUpdater.checkForUpdates();
                log.info(`[OTA] ${source.id} respondió correctamente`);
                return result;
            } catch (error) {
                const message = mensajeErrorOta(error);
                errors.push(`${source.id}: ${message}`);
                log.warn(`[OTA] fuente ${source.id} no disponible: ${message}`);
            }
        }
    } finally {
        ota_failoverActive = false;
    }

    throw new Error(`No hay servidores de actualización disponibles. ${errors.join(' | ')}`);
}

async function descargarActualizacionConFailover() {
    const expectedVersion = ota_updateInfo && ota_updateInfo.version;
    const startIndex = ota_activeSourceIndex;
    const errors = [];

    ota_failoverActive = true;
    try {
        for (let offset = 0; offset < OTA_UPDATE_SOURCES.length; offset += 1) {
            const index = (startIndex + offset) % OTA_UPDATE_SOURCES.length;
            const source = configurarFuenteOta(index);

            try {
                // Si cambiamos de mirror, refrescamos metadata para que electron-updater
                // asocie la descarga al provider correcto.
                if (offset > 0) {
                    ota_silentProviderRefresh = true;
                    const result = await autoUpdater.checkForUpdates();
                    const mirrorVersion = result && result.updateInfo && result.updateInfo.version;
                    if (expectedVersion && mirrorVersion !== expectedVersion) {
                        throw new Error(`mirror desincronizado: esperaba ${expectedVersion}, recibió ${mirrorVersion || 'sin versión'}`);
                    }
                }

                log.info(`[OTA] descargando desde ${source.id}`);
                await autoUpdater.downloadUpdate();
                return;
            } catch (error) {
                const message = mensajeErrorOta(error);
                errors.push(`${source.id}: ${message}`);
                log.warn(`[OTA] descarga falló en ${source.id}: ${message}`);
            } finally {
                ota_silentProviderRefresh = false;
            }
        }
    } finally {
        ota_failoverActive = false;
        ota_silentProviderRefresh = false;
    }

    throw new Error(`No fue posible descargar la actualización desde ningún mirror. ${errors.join(' | ')}`);
}

// Dejamos la fuente primaria configurada desde el arranque; los fallbacks se
// activan automáticamente sólo cuando la fuente anterior falla.
configurarFuenteOta(0);

const store = new Store({ name: 'arrow_credenciales' });

let tray = null;
let mainWindow = null;
let proxyProcess = null;
let desconexionManual = false;
let isVpnConnected = false;
let monitorInterval = null;
let singboxStdErr = '';
let singboxStdOut = '';

function isTrustedRenderer(event) {
    return Boolean(
        mainWindow &&
        !mainWindow.isDestroyed() &&
        event &&
        event.sender &&
        event.sender.id === mainWindow.webContents.id
    );
}

function trustedIpcOn(channel, listener) {
    ipcMain.on(channel, (event, ...args) => {
        if (!isTrustedRenderer(event)) return;
        return listener(event, ...args);
    });
}

function trustedIpcHandle(channel, listener) {
    ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedRenderer(event)) {
            throw new Error('IPC sender not authorized');
        }
        return listener(event, ...args);
    });
}

trustedIpcHandle('clipboard-write', (_event, text) => {
    const value = String(text ?? '');
    if (value.length > 1_000_000) throw new Error('Clipboard payload too large');
    clipboard.writeText(value);
    return true;
});

// Estado único del ciclo de red. Evita Connect/Disconnect concurrentes.
let networkState = 'DISCONNECTED';
let cleanupPromise = null;
let networkSetupProcess = null;
let monitorRecoveryInProgress = false;
let quitCleanupInProgress = false;
let quitCleanupDone = false;
let fatalCleanupInProgress = false;

// Estado de rendimiento/recuperación. La bandera persistente permite distinguir
// un cierre limpio de un crash sin tener que ejecutar PowerShell en cada arranque.
let networkTouchedThisSession = false;
let activeNetworkMode = null;
let motorLXValidationCache = null;
const reachabilityCache = new Map();
const REACHABILITY_CACHE_TTL_MS = 20_000;

// ==========================================
// MAGIA STEALTH: Puerto base, mutará al conectar
// ==========================================
let puertoStealthLocal = 10808;

const configEnMemoriaInicial = {
    tray: true,
    autoConnect: false,
    killSwitch: false,
    connectionMode: 'vpn',
    // --- NUEVO MODELO: suscripción en vez de uuid/password ---
    subUrlCifrada: '',        // la URL cifrada con safeStorage
    servidores: {},           // se rellena al refrescar el sub
    expiraSub: 0,             // timestamp Unix (0 = sin expiración)
    traficoSub: { upload: 0, download: 0, total: 0 },
    tituloSub: 'Arrow VPN',
    ultimoServidor: '',
    idioma: 'es'
};

let configEnMemoria = { ...configEnMemoriaInicial };

// ==========================================
// SISTEMA i18n PARA EL PROCESO PRINCIPAL
// ==========================================
const i18nMain = {
    es: {
        // Tray
        'tray-show': 'Mostrar Arrow VPN',
        'tray-quit': 'Salir por completo',

        // Alerta de desconexión pendiente
        'alert-disconnect-msg': 'Aún estás conectado a la VPN.',
        'alert-disconnect-detail': 'Por favor, desconéctate antes de salir para restaurar tu red.',
        'alert-disconnect-btn': 'Entendido',

        // Actualizador OTA
        'ota-downloading': 'Descargando actualización en 2do plano...',
        'ota-ready': 'Actualización lista.',
        'ota-btn-install': 'Instalar y Reiniciar',
        'ota-btn-later': 'Más tarde',
        'ota-title': 'Actualización Disponible',
        'ota-message': 'Se ha descargado una nueva versión de Arrow VPN.',
        'ota-detail': '¿Deseas instalarla y reiniciar la aplicación ahora?\n\nSi eliges "Más tarde", se instalará automáticamente cuando cierres la aplicación o apagues el equipo.',

        // Resúmenes de error para la UI
        'err-proxy-local': 'Error del proxy local.',
        'err-vpn-internal': 'Error interno del motor VPN.',
        'err-vpn-adapter': 'Error del adaptador VPN.',
        'err-dns': 'Error de resolución DNS.',
        'err-node-config': 'Configuración del nodo inválida.',
        'err-subscription': 'Error de suscripción.',
        'err-engine-start': 'El motor VPN no pudo iniciarse.',
        'err-engine': 'Error del motor VPN.',
        'err-proxy-start': 'No se pudo iniciar el proxy.',
        'err-vpn-start': 'No se pudo iniciar la VPN.',
        'err-engine-missing': 'Falta sing-box-lx en la carpeta bin.',
        'err-engine-lx': 'Arrow requiere sing-box-lx 1.14.1-lx.4 o superior.',
        'err-engine-config': 'El motor rechazó la configuración del nodo.',
        'err-reality': 'REALITY no pudo autenticar este nodo. Revisa versión del servidor, claves y key share.',
        'err-health': 'El túnel inició, pero no logró pasar tráfico de Internet.',
        'err-secure-storage': 'Windows no permite cifrar las credenciales de forma segura.',

        // Pérdida de conexión (monitor)
        'conn-lost-blocked': 'Conexión perdida. Red bloqueada.',
        'conn-lost': 'Conexión perdida.',

        // Login
        'login-bad-creds': 'Credenciales incorrectas',
        'login-master-err': 'Error de conexión con el servidor maestro.',

        // Validación de suscripción
        'sub-inactive': 'Suscripción inactiva',
        'sub-timeout': 'Timeout al validar',

        // Errores al conectar
        'conn-bad-key': 'Llave del nodo inválida.',
        'conn-server-unreachable': 'Servidor inaccesible.',
        'conn-sub-invalid': 'Suscripción inválida.',
        'conn-local-cfg': 'Error de configuración local.',

        // Instancia única
        'msg-already-running': 'Arrow VPN ya está abierto.',

        'sub-empty': 'Pega tu enlace de suscripción.',
        'sub-none': 'No hay suscripción activada.',
        'sub-expired': 'Tu suscripción ha expirado.',
        'sub-err-timeout': 'Tiempo de espera agotado. Revisa tu conexión.',
        'sub-err-network': 'No se pudo conectar. Revisa tu internet.',
        'sub-err-invalid-url': 'El enlace no es válido.',
        'sub-err-insecure-url': 'Por privacidad, las suscripciones remotas deben usar HTTPS.',
        'sub-err-too-large': 'La suscripción es demasiado grande para procesarla de forma segura.',
        'sub-err-no-servers': 'El enlace no contiene servidores.',
        'sub-err-http': 'El servidor de suscripción respondió con error.',
        'sub-err-generic': 'No se pudo cargar la suscripción.',

        "sub-hora": "hora",
        "sub-horas": "horas"
    },
    en: {
        // Tray
        'tray-show': 'Show Arrow VPN',
        'tray-quit': 'Quit completely',

        // Pending disconnect alert
        'alert-disconnect-msg': 'You are still connected to the VPN.',
        'alert-disconnect-detail': 'Please disconnect before exiting to restore your network.',
        'alert-disconnect-btn': 'Got it',

        // OTA updater
        'ota-downloading': 'Downloading update in background...',
        'ota-ready': 'Update ready.',
        'ota-btn-install': 'Install and Restart',
        'ota-btn-later': 'Later',
        'ota-title': 'Update Available',
        'ota-message': 'A new version of Arrow VPN has been downloaded.',
        'ota-detail': 'Do you want to install it and restart the application now?\n\nIf you choose "Later", it will be installed automatically when you close the application or shut down your computer.',

        // Error summaries for the UI
        'err-proxy-local': 'Local proxy error.',
        'err-vpn-internal': 'Internal VPN engine error.',
        'err-vpn-adapter': 'VPN adapter error.',
        'err-dns': 'DNS resolution error.',
        'err-node-config': 'Invalid node configuration.',
        'err-subscription': 'Subscription error.',
        'err-engine-start': 'The VPN engine could not start.',
        'err-engine': 'VPN engine error.',
        'err-proxy-start': 'Could not start the proxy.',
        'err-vpn-start': 'Could not start the VPN.',
        'err-engine-missing': 'sing-box-lx is missing from the bin folder.',
        'err-engine-lx': 'Arrow requires sing-box-lx 1.14.1-lx.4 or newer.',
        'err-engine-config': 'The engine rejected the node configuration.',
        'err-reality': 'REALITY could not authenticate this node. Check server version, keys and key share.',
        'err-health': 'The tunnel started, but Internet traffic did not pass through it.',
        'err-secure-storage': 'Windows secure credential encryption is unavailable.',

        // Connection loss (monitor)
        'conn-lost-blocked': 'Connection lost. Network blocked.',
        'conn-lost': 'Connection lost.',

        // Login
        'login-bad-creds': 'Invalid credentials',
        'login-master-err': 'Connection error with the master server.',

        // Subscription validation
        'sub-inactive': 'Inactive subscription',
        'sub-timeout': 'Validation timeout',

        // Connection errors
        'conn-bad-key': 'Invalid node key.',
        'conn-server-unreachable': 'Server unreachable.',
        'conn-sub-invalid': 'Invalid subscription.',
        'conn-local-cfg': 'Local configuration error.',

        // Single instance
        'msg-already-running': 'Arrow VPN is already running.',

        'sub-empty': 'Paste your subscription link.',
        'sub-none': 'No active subscription.',
        'sub-expired': 'Your subscription has expired.',
        'sub-err-timeout': 'Request timed out. Check your connection.',
        'sub-err-network': 'Could not connect. Check your internet.',
        'sub-err-invalid-url': 'The link is not valid.',
        'sub-err-insecure-url': 'For privacy, remote subscriptions must use HTTPS.',
        'sub-err-too-large': 'The subscription is too large to process safely.',
        'sub-err-no-servers': 'The link contains no servers.',
        'sub-err-http': 'Subscription server responded with an error.',
        'sub-err-generic': 'Could not load the subscription.',

        "sub-hora": "hour",
        "sub-horas": "hours"
    },
    ru: {
        // Трей
        'tray-show': 'Показать Arrow VPN',
        'tray-quit': 'Полностью выйти',

        // Предупреждение о незавершённом отключении
        'alert-disconnect-msg': 'Вы всё ещё подключены к VPN.',
        'alert-disconnect-detail': 'Пожалуйста, отключитесь перед выходом, чтобы восстановить сеть.',
        'alert-disconnect-btn': 'Понятно',

        // Обновления OTA
        'ota-downloading': 'Загрузка обновления в фоне...',
        'ota-ready': 'Обновление готово.',
        'ota-btn-install': 'Установить и перезапустить',
        'ota-btn-later': 'Позже',
        'ota-title': 'Доступно обновление',
        'ota-message': 'Загружена новая версия Arrow VPN.',
        'ota-detail': 'Установить её и перезапустить приложение сейчас?\n\nЕсли выбрать "Позже", обновление установится автоматически при закрытии приложения или выключении компьютера.',

        // Краткие сообщения об ошибках для UI
        'err-proxy-local': 'Ошибка локального прокси.',
        'err-vpn-internal': 'Внутренняя ошибка движка VPN.',
        'err-vpn-adapter': 'Ошибка VPN-адаптера.',
        'err-dns': 'Ошибка разрешения DNS.',
        'err-node-config': 'Неверная конфигурация узла.',
        'err-subscription': 'Ошибка подписки.',
        'err-engine-start': 'Движок VPN не смог запуститься.',
        'err-engine': 'Ошибка движка VPN.',
        'err-proxy-start': 'Не удалось запустить прокси.',
        'err-vpn-start': 'Не удалось запустить VPN.',
        'err-engine-missing': 'В папке bin отсутствует sing-box-lx.',
        'err-engine-lx': 'Arrow требует sing-box-lx 1.14.1-lx.4 или новее.',
        'err-engine-config': 'Движок отклонил конфигурацию узла.',
        'err-reality': 'REALITY не смог аутентифицировать узел. Проверьте версию сервера, ключи и key share.',
        'err-health': 'Туннель запущен, но интернет-трафик через него не проходит.',
        'err-secure-storage': 'Безопасное шифрование учётных данных Windows недоступно.',

        // Потеря соединения (монитор)
        'conn-lost-blocked': 'Соединение потеряно. Сеть заблокирована.',
        'conn-lost': 'Соединение потеряно.',

        // Вход
        'login-bad-creds': 'Неверные учётные данные',
        'login-master-err': 'Ошибка подключения к основному серверу.',

        // Проверка подписки
        'sub-inactive': 'Подписка неактивна',
        'sub-timeout': 'Таймаут проверки',

        // Ошибки подключения
        'conn-bad-key': 'Неверный ключ узла.',
        'conn-server-unreachable': 'Сервер недоступен.',
        'conn-sub-invalid': 'Неверная подписка.',
        'conn-local-cfg': 'Ошибка локальной конфигурации.',

        // Единственный экземпляр
        'msg-already-running': 'Arrow VPN уже запущен.',

        'sub-empty': 'Вставьте ссылку на подписку.',
        'sub-none': 'Нет активной подписки.',
        'sub-expired': 'Срок действия подписки истёк.',
        'sub-err-timeout': 'Превышено время ожидания. Проверьте соединение.',
        'sub-err-network': 'Не удалось подключиться. Проверьте интернет.',
        'sub-err-invalid-url': 'Ссылка недействительна.',
        'sub-err-insecure-url': 'Для приватности удалённые подписки должны использовать HTTPS.',
        'sub-err-too-large': 'Подписка слишком велика для безопасной обработки.',
        'sub-err-no-servers': 'Ссылка не содержит серверов.',
        'sub-err-http': 'Сервер подписки вернул ошибку.',
        'sub-err-generic': 'Не удалось загрузить подписку.',

        "sub-hora": "час",
        "sub-horas": "часов"
    }
};

function t(key) {
    const lang = (configEnMemoria && configEnMemoria.idioma) || 'es';
    return (i18nMain[lang] && i18nMain[lang][key]) || i18nMain.es[key] || key;
}

const rutaBinarios = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'bin')
    : path.join(__dirname, 'bin');

// APUNTAMOS AL NUEVO MOTOR: SING-BOX
const singboxPath = path.join(rutaBinarios, 'sing-box.exe');
const configJsonPath = path.join(app.getPath('userData'), 'config.json');
const singboxLogPath = path.join(app.getPath('userData'), 'singbox_error.log');
const appErrorLogPath = path.join(app.getPath('userData'), 'app_error.log');
const networkSnapshotPath = path.join(app.getPath('userData'), 'network_snapshot.json');
const firewallSnapshotPath = path.join(app.getPath('userData'), 'firewall_snapshot.json');
const networkDirtyFlagPath = path.join(app.getPath('userData'), 'network_dirty.flag');

const proxyFlagPath = path.join(app.getPath('userData'), 'proxy_active.flag');
const INTERNET_SETTINGS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const PROXY_REGISTRY_VALUES = ['ProxyEnable', 'ProxyServer', 'ProxyOverride', 'AutoConfigURL'];

const API_BASE_URL = 'https://arrow-x.org';

function getLocalIP() {
    try {
        const interfaces = os.networkInterfaces();

        for (const name of Object.keys(interfaces)) {
            const lowerName = name.toLowerCase();

            if (
                lowerName.includes('tun') ||
                lowerName.includes('tap') ||
                lowerName.includes('virtual') ||
                lowerName.includes('vethernet') ||
                lowerName.includes('npcap')
            ) {
                continue;
            }

            for (const iface of interfaces[name]) {
                if (
                    iface.family === 'IPv4' &&
                    !iface.internal &&
                    iface.address !== '172.19.0.2' &&
                    !iface.address.startsWith('169.254')
                ) {
                    return iface.address;
                }
            }
        }
    } catch (e) {}

    return null;
}

// ==========================================
// CONFIGURACIÓN DE AJUSTES EN STORE
// ==========================================
function normalizarMapaServidores(servidores) {
    const out = {};
    if (!servidores || typeof servidores !== 'object') return out;
    for (const [oldId, item] of Object.entries(servidores)) {
        if (!item || typeof item !== 'object') continue;
        const uri = item.uri || item.vless || item.raw || '';
        const parsed = uri ? protocols.parseNodeUri(uri) : null;
        if (!parsed) continue;
        const id = parsed.id || oldId;
        out[id] = {
            ...protocols.sanitizeNode(parsed),
            uri
        };
    }
    return out;
}

function getSettings() {
    const saved = store.get('userSettings') || {};
    let servidores = {};
    if (saved.servidoresCifrados) {
        servidores = normalizarMapaServidores(subscription.descifrarServidores(saved.servidoresCifrados));
    } else if (saved.servidores) {
        // Migración 3.0.2 -> 3.1: se lee una sola vez el mapa en claro.
        servidores = normalizarMapaServidores(saved.servidores);
    }

    return {
        subUrlCifrada: saved.subUrlCifrada || '',
        servidores,
        expiraSub: saved.expiraSub || 0,
        traficoSub: saved.traficoSub || { upload: 0, download: 0, total: 0 },
        tituloSub: saved.tituloSub || 'Arrow VPN',
        ultimoServidor: saved.ultimoServidor || '',
        tray: (saved.tray === false || saved.tray === 'false') ? false : true,
        autoConnect: (saved.autoConnect === true || saved.autoConnect === 'true'),
        killSwitch: (saved.killSwitch === true || saved.killSwitch === 'true'),
        connectionMode: saved.connectionMode || 'vpn',
        idioma: saved.idioma || null
    };
}

function servidoresPublicos() {
    const out = {};
    for (const [id, srv] of Object.entries(configEnMemoria.servidores || {})) {
        out[id] = {
            id,
            protocol: srv.protocol || protocols.parseNodeUri(srv.uri || '')?.protocol || 'unknown',
            nombre: srv.nombre || srv.displayName || srv.host || id,
            nombreEN: srv.nombreEN || srv.nombre || srv.host || id,
            nombreRU: srv.nombreRU || srv.nombre || srv.host || id,
            iso: srv.iso || 'UN',
            emoji: srv.emoji || '',
            host: srv.host || '',
            port: srv.port || 0
        };
    }
    return out;
}

function settingsPublicos() {
    return {
        expiraSub: configEnMemoria.expiraSub,
        traficoSub: configEnMemoria.traficoSub,
        tituloSub: configEnMemoria.tituloSub,
        ultimoServidor: configEnMemoria.ultimoServidor,
        tray: configEnMemoria.tray,
        autoConnect: configEnMemoria.autoConnect,
        killSwitch: configEnMemoria.killSwitch,
        connectionMode: configEnMemoria.connectionMode,
        idioma: configEnMemoria.idioma,
        servidores: servidoresPublicos()
    };
}

function persistirSettings({ persistServers = true } = {}) {
    const existing = store.get('userSettings') || {};
    let servidoresCifrados = existing.servidoresCifrados || '';
    if (persistServers) {
        if (Object.keys(configEnMemoria.servidores || {}).length) {
            servidoresCifrados = subscription.cifrarServidores(configEnMemoria.servidores);
        } else {
            servidoresCifrados = '';
        }
    }
    const persisted = {
        subUrlCifrada: configEnMemoria.subUrlCifrada || '',
        servidoresCifrados,
        expiraSub: configEnMemoria.expiraSub || 0,
        traficoSub: configEnMemoria.traficoSub || { upload: 0, download: 0, total: 0 },
        tituloSub: configEnMemoria.tituloSub || 'Arrow VPN',
        ultimoServidor: configEnMemoria.ultimoServidor || '',
        tray: configEnMemoria.tray !== false,
        autoConnect: Boolean(configEnMemoria.autoConnect),
        killSwitch: Boolean(configEnMemoria.killSwitch),
        connectionMode: configEnMemoria.connectionMode || 'vpn',
        idioma: configEnMemoria.idioma || 'en'
    };
    store.set('userSettings', persisted);
    // Elimina la copia histórica en texto plano tras migrar.
    if (Object.hasOwn(existing, 'servidores')) {
        try { store.delete('userSettings.servidores'); } catch (_) {}
    }
}

const IDIOMAS_SOPORTADOS = ['es', 'en', 'ru'];

function detectarIdiomaSO() {
    try {
        const locale = (app.getLocale() || '').toLowerCase();
        const codigo = locale.split('-')[0];

        if (IDIOMAS_SOPORTADOS.includes(codigo)) {
            return codigo;
        }
    } catch (e) {}

    return 'en';
}

function asegurarIdiomaInicial() {
    if (!configEnMemoria.idioma) {
        const detectado = detectarIdiomaSO();
        configEnMemoria.idioma = detectado;
        persistirSettings({ persistServers: false });
        console.log(`[i18n] Idioma autodetectado en primera apertura: ${detectado}`);
    }
}


function createWindow() {
    mainWindow = new BrowserWindow({
        width: 380,
        height: 600,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs'),
            sandbox: true
        }
    });

    mainWindow.loadFile('index.html');

    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (url !== mainWindow.webContents.getURL()) event.preventDefault();
    });
    mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false);
    });

    mainWindow.on('close', (event) => {
        if (app.isQuitting) return;

        event.preventDefault();

        if (configEnMemoria.tray) {
            mainWindow.hide();
        } else {
            if (isVpnConnected) {
                mostrarAlertaDesconexion();
            } else {
                app.isQuitting = true;
                mainWindow.destroy();
                app.quit();
            }
        }
    });
}

function mostrarAlertaDesconexion() {
    dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        title: 'Arrow VPN',
        message: t('alert-disconnect-msg'),
        detail: t('alert-disconnect-detail'),
        buttons: [t('alert-disconnect-btn')]
    });
}

function registrarErrorApp(contexto, detalle) {
    try {
        const bloque = [
            `\n[${new Date().toISOString()}] [${contexto}]`,
            detalle || 'Sin detalle',
            '------------------------------------------------------------'
        ].join('\n');

        fs.appendFileSync(appErrorLogPath, bloque, 'utf8');
    } catch (e) {}
}

function resumirErrorParaUI(errorMsg, modo = 'vpn') {
    const txt = String(errorMsg || '').toLowerCase();

    if (txt.includes('sing-box-lx_missing')) return t('err-engine-missing');
    if (txt.includes('sing-box-lx_required') || txt.includes('sing-box-lx_too_old')) return t('err-engine-lx');
    if (txt.includes('config_check_failed') || txt.includes('check -c')) return t('err-engine-config');
    if (txt.includes('reality verification failed') || txt.includes('reality key_share') || txt.includes('reality handshake')) return t('err-reality');
    if (txt.includes('health_check_failed')) return t('err-health');
    if (txt.includes('secure_storage_unavailable')) return t('err-secure-storage');
    if (txt.includes('timeout esperando puerto')) return modo === 'proxy' ? t('err-proxy-local') : t('err-vpn-internal');
    if (txt.includes('adaptador tun')) return t('err-vpn-adapter');
    if (txt.includes('dns')) return t('err-dns');
    if (txt.includes('llave del nodo') || txt.includes('unsupported_node') || txt.includes('invalid_')) return t('err-node-config');
    if (txt.includes('suscripción')) return t('err-subscription');
    if (txt.includes('sing-box terminó inmediatamente')) return t('err-engine-start');
    if (txt.includes('no se pudo lanzar sing-box') || txt.includes('error iniciando sing-box')) return t('err-engine');

    return modo === 'proxy' ? t('err-proxy-start') : t('err-vpn-start');
}

function mapearErrorSub(codigo) {
    switch (codigo) {
        case 'timeout':       return t('sub-err-timeout');
        case 'network':       return t('sub-err-network');
        case 'invalid_url':   return t('sub-err-invalid-url');
        case 'insecure_url':  return t('sub-err-insecure-url');
        case 'too_large':     return t('sub-err-too-large');
        case 'no_servers':    return t('sub-err-no-servers');
        default:
            if (String(codigo).startsWith('http_')) {
                return t('sub-err-http');
            }
            return t('sub-err-generic');
    }
}

function setNetworkState(nextState, reason = '') {
    const previous = networkState;
    networkState = nextState;
    console.log(`[network] ${previous} -> ${nextState}${reason ? ` (${reason})` : ''}`);
}

function crearTrazaRendimiento(scope) {
    const startedAt = Date.now();
    let previousAt = startedAt;
    return {
        mark(step) {
            const now = Date.now();
            log.info(`[perf][${scope}] ${step}: +${now - previousAt}ms total=${now - startedAt}ms`);
            previousAt = now;
        },
        done(step = 'total') {
            const now = Date.now();
            log.info(`[perf][${scope}] ${step}: ${now - startedAt}ms`);
            return now - startedAt;
        }
    };
}

function marcarRedSucia() {
    networkTouchedThisSession = true;
    try {
        fs.writeFileSync(networkDirtyFlagPath, JSON.stringify({
            version: 1,
            pid: process.pid,
            createdAt: new Date().toISOString()
        }), 'utf8');
    } catch (e) {
        registrarErrorApp('network-dirty-flag', e.message || String(e));
    }
}

function marcarRedLimpia() {
    networkTouchedThisSession = false;
    activeNetworkMode = null;
    try {
        if (fs.existsSync(networkDirtyFlagPath)) fs.unlinkSync(networkDirtyFlagPath);
    } catch (e) {
        registrarErrorApp('network-clean-flag', e.message || String(e));
    }
}

function hayArtefactosPersistentes() {
    try {
        return fs.existsSync(networkDirtyFlagPath)
            || fs.existsSync(networkSnapshotPath)
            || fs.existsSync(firewallSnapshotPath)
            || fs.existsSync(proxyFlagPath);
    } catch (_) {
        return true;
    }
}

function procesoVivo(child) {
    return Boolean(child && child.exitCode === null && !child.killed);
}

function necesitaLimpiezaActiva() {
    return networkTouchedThisSession
        || hayArtefactosPersistentes()
        || procesoVivo(proxyProcess)
        || procesoVivo(networkSetupProcess)
        || isVpnConnected;
}

function ocultarInterfazParaSalida() {
    try {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    } catch (_) {}
    try {
        if (tray && !tray.isDestroyed()) tray.destroy();
    } catch (_) {}
}

function leerValorRegistro(nombre) {
    try {
        const result = spawnSync('reg', ['query', INTERNET_SETTINGS_KEY, '/v', nombre], {
            windowsHide: true,
            encoding: 'utf8'
        });
        if (result.status !== 0) return { exists: false, type: null, data: null };

        const escaped = nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`^\\s*${escaped}\\s+(REG_[A-Z0-9_]+)\\s+(.*)$`, 'mi');
        const match = String(result.stdout || '').match(re);
        if (!match) return { exists: false, type: null, data: null };
        return { exists: true, type: match[1], data: match[2].trim() };
    } catch (e) {
        registrarErrorApp('network-reg-read', `${nombre}: ${e.message || e}`);
        return { exists: false, type: null, data: null };
    }
}

function guardarSnapshotProxyOriginal() {
    try {
        // Si existe, pertenece a una sesión que todavía no terminó limpiamente.
        // Nunca la sobrescribimos: ese snapshot es precisamente nuestro rollback.
        if (fs.existsSync(networkSnapshotPath)) return;

        const values = {};
        for (const name of PROXY_REGISTRY_VALUES) values[name] = leerValorRegistro(name);
        fs.writeFileSync(networkSnapshotPath, JSON.stringify({
            version: 1,
            createdAt: new Date().toISOString(),
            values
        }, null, 2), 'utf8');
    } catch (e) {
        registrarErrorApp('network-snapshot-save', e.stack || e.message || String(e));
    }
}

function cargarSnapshotProxyOriginal() {
    try {
        if (!fs.existsSync(networkSnapshotPath)) return null;
        return JSON.parse(fs.readFileSync(networkSnapshotPath, 'utf8'));
    } catch (e) {
        registrarErrorApp('network-snapshot-read', e.stack || e.message || String(e));
        return null;
    }
}

function aplicarValorRegistro(nombre, item) {
    try {
        if (!item || !item.exists) {
            spawnSync('reg', ['delete', INTERNET_SETTINGS_KEY, '/v', nombre, '/f'], {
                windowsHide: true,
                stdio: 'ignore'
            });
            return true;
        }

        let data = String(item.data ?? '');
        if (item.type === 'REG_DWORD') {
            const parsed = data.toLowerCase().startsWith('0x') ? parseInt(data, 16) : parseInt(data, 10);
            if (!Number.isNaN(parsed)) data = String(parsed);
        }

        const result = spawnSync('reg', ['add', INTERNET_SETTINGS_KEY, '/v', nombre, '/t', item.type || 'REG_SZ', '/d', data, '/f'], {
            windowsHide: true,
            stdio: 'ignore'
        });
        return result.status === 0;
    } catch (e) {
        registrarErrorApp('network-reg-restore', `${nombre}: ${e.message || e}`);
        return false;
    }
}

async function ejecutarPowerShell(script, timeoutMs = 15000) {
    const result = await ejecutarComandoCapturando(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { timeoutMs }
    );
    return result;
}

function ejecutarPowerShellSetup(script, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let stdout = '';
        let stderr = '';
        let timer = null;

        try {
            const child = spawn(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', script],
                { windowsHide: true }
            );
            networkSetupProcess = child;

            child.stdout?.on('data', data => { stdout += data.toString(); });
            child.stderr?.on('data', data => { stderr += data.toString(); });
            child.once('error', err => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                if (networkSetupProcess === child) networkSetupProcess = null;
                reject(err);
            });
            child.once('close', code => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                if (networkSetupProcess === child) networkSetupProcess = null;
                resolve({ code, stdout, stderr });
            });

            timer = setTimeout(() => {
                if (settled) return;
                try {
                    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
                } catch (e) {}
            }, timeoutMs);
        } catch (e) {
            networkSetupProcess = null;
            reject(e);
        }
    });
}

async function detenerNetworkSetupPendiente() {
    const child = networkSetupProcess;
    if (!child || child.exitCode !== null) {
        networkSetupProcess = null;
        return;
    }

    try {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch (e) {}

    if (networkSetupProcess === child) networkSetupProcess = null;
}

async function refrescarProxyWindows() {
    const psCode = `
        $signature = @'
        [DllImport("wininet.dll", SetLastError = true, CharSet=CharSet.Auto)]
        public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
'@
        $interopHelper = Add-Type -MemberDefinition $signature -Name "WinInetHelper" -Namespace "WinInet" -PassThru -ErrorAction SilentlyContinue
        if ($interopHelper) {
            $interopHelper::InternetSetOption(0, 39, 0, 0) | Out-Null
            $interopHelper::InternetSetOption(0, 37, 0, 0) | Out-Null
        }
    `;
    try { await ejecutarPowerShell(psCode, 8000); } catch (e) {}
}

// ==========================================
// HELPERS DEL FLAG DE PROXY ACTIVO
// ==========================================
function marcarProxyActivo(puerto, modo) {
    try {
        const data = JSON.stringify({
            port: puerto,
            modo: modo || 'proxy',
            timestamp_iso: new Date().toISOString(),
            pid: process.pid
        });
        fs.writeFileSync(proxyFlagPath, data, 'utf8');
    } catch (e) {
        registrarErrorApp('marcar-proxy-activo', e.message || String(e));
    }
}

function marcarProxyInactivo() {
    try {
        if (fs.existsSync(proxyFlagPath)) fs.unlinkSync(proxyFlagPath);
    } catch (e) {
        registrarErrorApp('marcar-proxy-inactivo', e.message || String(e));
    }
}

function huboProxyActivoAnteriormente() {
    try { return fs.existsSync(proxyFlagPath); } catch (e) { return false; }
}

async function desactivarProxyTemporalmente() {
    try {
        const p = session.defaultSession.setProxy({ proxyRules: 'direct://' });
        if (p && typeof p.then === 'function') await p;
    } catch (e) {}

    // Evitamos cuatro lecturas de registro + PowerShell cuando Windows ya no usa proxy.
    const proxyEnabled = leerValorRegistro('ProxyEnable');
    const enabled = proxyEnabled.exists
        && (String(proxyEnabled.data).toLowerCase() === '0x1' || String(proxyEnabled.data) === '1');
    if (!enabled) return true;

    guardarSnapshotProxyOriginal();

    try {
        const result = await ejecutarComandoCapturando('reg', [
            'add', INTERNET_SETTINGS_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'
        ], { timeoutMs: 5000 });
        if (result.code !== 0) return false;
    } catch (e) {
        return false;
    }

    await refrescarProxyWindows();
    return true;
}

async function activarProxySistema() {
    guardarSnapshotProxyOriginal();

    try {
        const p = session.defaultSession.setProxy({
            proxyRules: `http=127.0.0.1:${puertoStealthLocal};https=127.0.0.1:${puertoStealthLocal}`
        });
        if (p && typeof p.then === 'function') await p;
    } catch (e) {}

    try { mainWindow?.webContents?.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'); } catch (e) {}

    const r1 = await ejecutarComandoCapturando('reg', [
        'add', INTERNET_SETTINGS_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'
    ], { timeoutMs: 5000 });
    const r2 = await ejecutarComandoCapturando('reg', [
        'add', INTERNET_SETTINGS_KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', `127.0.0.1:${puertoStealthLocal}`, '/f'
    ], { timeoutMs: 5000 });

    if (r1.code !== 0 || r2.code !== 0) {
        throw new Error(`No se pudo activar el proxy de Windows (${r1.code}/${r2.code}).`);
    }

    await refrescarProxyWindows();
    marcarProxyActivo(puertoStealthLocal, 'proxy');
}

async function restaurarProxyOriginal() {
    const snapshot = cargarSnapshotProxyOriginal();
    const hadArrowProxy = huboProxyActivoAnteriormente();
    let restoredOk = true;
    let registryTouched = false;

    if (snapshot && snapshot.values) {
        registryTouched = true;
        for (const name of PROXY_REGISTRY_VALUES) {
            restoredOk = aplicarValorRegistro(name, snapshot.values[name]) && restoredOk;
        }
    } else if (hadArrowProxy) {
        // Compatibilidad con sesiones antiguas (<=3.0.1): solo deshabilitamos
        // un proxy local de Arrow. No borramos proxies ajenos del usuario.
        const currentServer = leerValorRegistro('ProxyServer');
        if (currentServer.exists && /^127\.0\.0\.1:\d+$/i.test(currentServer.data || '')) {
            registryTouched = true;
            restoredOk = aplicarValorRegistro('ProxyEnable', { exists: true, type: 'REG_DWORD', data: '0' }) && restoredOk;
            restoredOk = aplicarValorRegistro('ProxyServer', { exists: false }) && restoredOk;
        }
    }

    try {
        const p = session.defaultSession.setProxy({ mode: 'system' });
        if (p && typeof p.then === 'function') await p;
    } catch (e) {
        restoredOk = false;
    }
    try { mainWindow?.webContents?.setWebRTCIPHandlingPolicy('default'); } catch (e) {}

    if (registryTouched) await refrescarProxyWindows();

    if (!snapshot || restoredOk) {
        marcarProxyInactivo();
        try { if (fs.existsSync(networkSnapshotPath)) fs.unlinkSync(networkSnapshotPath); } catch (e) {}
    } else {
        registrarErrorApp('network-snapshot-retained', 'No se pudo restaurar completamente el proxy original; se conserva el snapshot para reintentar al próximo inicio.');
    }

    return restoredOk;
}

async function limpiarArtefactosArrow({ flushDns = true, removeTunRoutes = true, legacyFirewallCleanup = false } = {}) {
    let ok = true;

    // Solo se ejecuta en recuperación estricta para limpiar reglas de versiones antiguas.
    if (legacyFirewallCleanup) {
        try {
            const legacy = await ejecutarComandoCapturando('netsh', [
                'advfirewall', 'firewall', 'delete', 'rule', 'name=Arrow_KS_Block'
            ], { timeoutMs: 5000 });
            ok = legacy.code === 0 || legacy.code === 1;
        } catch (e) {
            ok = false;
        }
    }

    const ps = `
        $ErrorActionPreference = 'Stop'
        $arrowNrpt = @(Get-DnsClientNrptRule -ErrorAction SilentlyContinue | Where-Object {$_.Comment -eq 'ArrowVPN'})
        if ($arrowNrpt.Count -gt 0) { $arrowNrpt | Remove-DnsClientNrptRule -Force -ErrorAction Stop }
        ${removeTunRoutes ? "$arrowRoutes = @(Get-NetRoute -InterfaceAlias 'ArrowTUN' -ErrorAction SilentlyContinue); if ($arrowRoutes.Count -gt 0) { $arrowRoutes | Remove-NetRoute -Confirm:$false -ErrorAction Stop }" : ''}
        ${flushDns ? 'Clear-DnsClientCache -ErrorAction Stop' : ''}
    `;
    try {
        const result = await ejecutarPowerShell(ps, 10000);
        if (result.code !== 0) ok = false;
    } catch (e) {
        ok = false;
    }
    return ok;
}

async function aplicarConfiguracionTun() {
    const ps = `
        $ErrorActionPreference = 'Stop'
        netsh interface ip set address "ArrowTUN" static 172.19.0.2 255.255.255.0 172.19.0.1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'IPv4 address setup failed' }
        netsh interface ip set dns "ArrowTUN" static 1.1.1.1 validate=no | Out-Null
        netsh interface ipv6 set dnsservers "ArrowTUN" static 2606:4700:4700::1111 validate=no | Out-Null
        netsh interface ipv4 set interface "ArrowTUN" metric=1 | Out-Null
        netsh interface ipv6 set interface "ArrowTUN" metric=1 | Out-Null
        Get-DnsClientNrptRule -ErrorAction SilentlyContinue | Where-Object {$_.Comment -eq 'ArrowVPN'} | Remove-DnsClientNrptRule -Force -ErrorAction SilentlyContinue
        Add-DnsClientNrptRule -Namespace '.' -NameServers '1.1.1.1','2606:4700:4700::1111' -Comment 'ArrowVPN' -ErrorAction Stop | Out-Null
        Clear-DnsClientCache
    `;

    const result = await ejecutarPowerShellSetup(ps, 30000);
    if (result.code !== 0) {
        throw new Error(`Falló la configuración de red de ArrowTUN: ${result.stderr || `code=${result.code}`}`);
    }
}

async function verificarLimpiezaRed() {
    const problemas = [];

    try {
        const p = await ejecutarComandoCapturando('tasklist', ['/FI', 'IMAGENAME eq sing-box.exe', '/FO', 'CSV', '/NH'], { timeoutMs: 4000 });
        if ((p.stdout || '').toLowerCase().includes('sing-box.exe')) problemas.push('sing-box sigue ejecutándose');
    } catch (e) {}

    try {
        const nrpt = await ejecutarPowerShell("(Get-DnsClientNrptRule -ErrorAction SilentlyContinue | Where-Object {$_.Comment -eq 'ArrowVPN'} | Measure-Object).Count", 5000);
        if (parseInt(String(nrpt.stdout || '').trim(), 10) > 0) problemas.push('NRPT ArrowVPN sigue presente');
    } catch (e) {}

    try {
        const routes = await ejecutarPowerShell("(Get-NetRoute -InterfaceAlias 'ArrowTUN' -ErrorAction SilentlyContinue | Where-Object {$_.DestinationPrefix -eq '0.0.0.0/0' -or $_.DestinationPrefix -eq '::/0'} | Measure-Object).Count", 5000);
        if (parseInt(String(routes.stdout || '').trim(), 10) > 0) problemas.push('quedan rutas por defecto en ArrowTUN');
    } catch (e) {}

    const proxyEnabled = leerValorRegistro('ProxyEnable');
    const proxyServer = leerValorRegistro('ProxyServer');
    const enabled = proxyEnabled.exists && (String(proxyEnabled.data).toLowerCase() === '0x1' || String(proxyEnabled.data) === '1');
    if (enabled && proxyServer.exists && String(proxyServer.data || '') === `127.0.0.1:${puertoStealthLocal}`) {
        problemas.push('proxy local de Arrow sigue activo');
    }

    return problemas;
}


function psQuote(value) {
    return String(value ?? '').replace(/'/g, "''");
}

async function guardarSnapshotFirewallOriginal() {
    if (fs.existsSync(firewallSnapshotPath)) return;
    const ps = `Get-NetFirewallProfile | ForEach-Object { [PSCustomObject]@{ Name=$_.Name; Action=$_.DefaultOutboundAction.ToString() } } | ConvertTo-Json -Compress`;
    const result = await ejecutarPowerShell(ps, 8000);
    if (result.code !== 0) throw new Error(`kill_switch_snapshot_failed: ${result.stderr || result.stdout}`);
    let profiles = [];
    try {
        const parsed = JSON.parse(String(result.stdout || '').trim() || '[]');
        profiles = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
        throw new Error('kill_switch_snapshot_failed: invalid firewall profile JSON');
    }
    fs.writeFileSync(firewallSnapshotPath, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), profiles }, null, 2), 'utf8');
}

async function activarKillSwitchBase() {
    await guardarSnapshotFirewallOriginal();
    const engine = psQuote(singboxPath);
    const ps = `
        $ErrorActionPreference='Stop'
        Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -like 'Arrow_KS_*'} | Remove-NetFirewallRule -ErrorAction SilentlyContinue
        New-NetFirewallRule -DisplayName 'Arrow_KS_Engine' -Direction Outbound -Action Allow -Program '${engine}' -Profile Any | Out-Null
        New-NetFirewallRule -DisplayName 'Arrow_KS_Loopback' -Direction Outbound -Action Allow -RemoteAddress '127.0.0.1','::1' -Profile Any | Out-Null
        Set-NetFirewallProfile -Profile Domain,Private,Public -DefaultOutboundAction Block
    `;
    const result = await ejecutarPowerShell(ps, 12000);
    if (result.code !== 0) throw new Error(`kill_switch_enable_failed: ${result.stderr || result.stdout}`);
}

async function permitirTunKillSwitch() {
    if (!configEnMemoria.killSwitch || configEnMemoria.connectionMode !== 'vpn') return;
    const ps = `
        $ErrorActionPreference='Stop'
        Get-NetFirewallRule -DisplayName 'Arrow_KS_TUN' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
        New-NetFirewallRule -DisplayName 'Arrow_KS_TUN' -Direction Outbound -Action Allow -InterfaceAlias 'ArrowTUN' -Profile Any | Out-Null
    `;
    const result = await ejecutarPowerShell(ps, 8000);
    if (result.code !== 0) throw new Error(`kill_switch_tun_failed: ${result.stderr || result.stdout}`);
}

async function restaurarKillSwitch() {
    let snapshot = null;
    try {
        if (fs.existsSync(firewallSnapshotPath)) snapshot = JSON.parse(fs.readFileSync(firewallSnapshotPath, 'utf8'));
    } catch (e) {
        registrarErrorApp('firewall-snapshot-read', e.message || String(e));
        return false;
    }

    // Sin snapshot nunca llegamos a cambiar DefaultOutboundAction en esta sesión.
    // Evita lanzar PowerShell en cada desconexión/quit cuando Kill Switch estaba apagado.
    if (!snapshot) return true;

    const restoreLines = [];
    for (const profile of snapshot?.profiles || []) {
        const name = ['Domain', 'Private', 'Public'].includes(profile?.Name) ? profile.Name : null;
        const action = ['Allow', 'Block', 'NotConfigured'].includes(profile?.Action) ? profile.Action : null;
        if (name && action) restoreLines.push(`Set-NetFirewallProfile -Profile ${name} -DefaultOutboundAction ${action}`);
    }
    const ps = `
        $ErrorActionPreference='Stop'
        $arrowRules = @(Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -like 'Arrow_KS_*'})
        if ($arrowRules.Count -gt 0) { $arrowRules | Remove-NetFirewallRule -ErrorAction Stop }
        ${restoreLines.map(line => `${line} -ErrorAction Stop`).join('\n')}
    `;
    const result = await ejecutarPowerShell(ps, 10000);
    const ok = result.code === 0;
    if (!ok) {
        registrarErrorApp('firewall-restore', result.stderr || result.stdout || `code=${result.code}`);
        return false;
    }

    try { fs.unlinkSync(firewallSnapshotPath); } catch (e) {}
    return true;
}

function restaurarKillSwitchSincrono() {
    try {
        let snapshot = null;
        if (fs.existsSync(firewallSnapshotPath)) snapshot = JSON.parse(fs.readFileSync(firewallSnapshotPath, 'utf8'));
        const lines = [`Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -like 'Arrow_KS_*'} | Remove-NetFirewallRule -ErrorAction SilentlyContinue`];
        for (const profile of snapshot?.profiles || []) {
            if (['Domain', 'Private', 'Public'].includes(profile?.Name) && ['Allow', 'Block', 'NotConfigured'].includes(profile?.Action)) {
                lines.push(`Set-NetFirewallProfile -Profile ${profile.Name} -DefaultOutboundAction ${profile.Action}`);
            }
        }
        execSync(`powershell.exe -NoProfile -NonInteractive -Command "${lines.join('; ').replace(/"/g, '\\"')}"`, { windowsHide: true, stdio: 'ignore', timeout: 4000 });
        if (snapshot) fs.unlinkSync(firewallSnapshotPath);
    } catch (e) {}
}

async function prepararRedAntesDeConexion() {
    activeNetworkMode = configEnMemoria.connectionMode;
    marcarRedSucia();
    const proxyOk = await desactivarProxyTemporalmente();
    if (!proxyOk) throw new Error('No se pudo preparar el proxy de Windows.');
}

async function restaurarRedWindows(reason = 'manual', { preserveKillSwitch = false } = {}) {
    if (cleanupPromise) return cleanupPromise;

    // Fallos previos al primer cambio de red no necesitan PowerShell, tasklist ni DNS flush.
    if (!necesitaLimpiezaActiva()) {
        isVpnConnected = false;
        setNetworkState('DISCONNECTED', `${reason}-noop`);
        return [];
    }

    const strictVerification = reason === 'startup'
        || reason === 'pre-connect-recovery'
        || reason === 'sing-box-crash'
        || reason === 'monitor-exception'
        || reason === 'uncaught-exception'
        || reason.startsWith('signal-');
    const perf = crearTrazaRendimiento(`cleanup:${reason}`);

    cleanupPromise = (async () => {
        const wasDisconnecting = networkState === 'DISCONNECTING';
        if (!wasDisconnecting) setNetworkState('RECOVERING', reason);
        desconexionManual = true;
        isVpnConnected = false;

        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }

        await detenerNetworkSetupPendiente();
        perf.mark('network-setup stopped');

        let engineOk = await detenerSingbox({ checkOrphans: strictVerification });
        perf.mark('engine stopped');

        const cleanupMode = activeNetworkMode || configEnMemoria.connectionMode;
        const needsTunCleanup = strictVerification || cleanupMode === 'vpn';
        let artifactsOk = needsTunCleanup
            ? await limpiarArtefactosArrow({
                flushDns: true,
                removeTunRoutes: true,
                legacyFirewallCleanup: strictVerification
            })
            : true;
        perf.mark(needsTunCleanup ? 'routes/dns cleaned' : 'routes/dns skipped');

        let proxyOk = await restaurarProxyOriginal();
        perf.mark('proxy restored');

        let firewallOk = preserveKillSwitch ? true : await restaurarKillSwitch();
        perf.mark(preserveKillSwitch ? 'kill switch preserved' : 'firewall restored');

        let problemas = [];
        if (strictVerification || !engineOk || !artifactsOk || !proxyOk || !firewallOk) {
            problemas = await verificarLimpiezaRed();
            perf.mark('cleanup verified');
        }

        if (problemas.length) {
            registrarErrorApp('network-cleanup-retry', `${reason}: ${problemas.join('; ')}`);
            engineOk = await detenerSingbox({ checkOrphans: true });
            artifactsOk = await limpiarArtefactosArrow({ flushDns: true, removeTunRoutes: true, legacyFirewallCleanup: true });
            proxyOk = await restaurarProxyOriginal();
            if (!preserveKillSwitch) firewallOk = await restaurarKillSwitch();
            problemas = await verificarLimpiezaRed();
            perf.mark('cleanup retry');
        }

        if (problemas.length) {
            registrarErrorApp('network-cleanup-warning', `${reason}: ${problemas.join('; ')}`);
        }

        try { if (fs.existsSync(configJsonPath)) fs.unlinkSync(configJsonPath); } catch (_) {}

        const cleanupComplete = problemas.length === 0
            && engineOk
            && artifactsOk
            && proxyOk
            && firewallOk
            && (!preserveKillSwitch || !fs.existsSync(firewallSnapshotPath));

        if (cleanupComplete && !preserveKillSwitch) {
            marcarRedLimpia();
        } else {
            networkTouchedThisSession = true;
        }

        setNetworkState('DISCONNECTED', reason);
        perf.done();
        return problemas;
    })().finally(() => {
        cleanupPromise = null;
    });

    return cleanupPromise;
}

function restaurarRedWindowsSincronoEmergencia() {
    if (!necesitaLimpiezaActiva()) return;

    let emergencyOk = true;
    try { execSync('taskkill /IM sing-box.exe /F /T', { windowsHide: true, stdio: 'ignore', timeout: 1800 }); } catch (e) {}
    try {
        execSync(`powershell.exe -NoProfile -NonInteractive -Command "Get-DnsClientNrptRule -ErrorAction SilentlyContinue | Where-Object {$_.Comment -eq 'ArrowVPN'} | Remove-DnsClientNrptRule -Force -ErrorAction SilentlyContinue; Get-NetRoute -InterfaceAlias 'ArrowTUN' -ErrorAction SilentlyContinue | Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue; Clear-DnsClientCache"`, {
            windowsHide: true,
            stdio: 'ignore',
            timeout: 3000
        });
    } catch (e) {
        emergencyOk = false;
    }
    try { execSync('netsh advfirewall firewall delete rule name=Arrow_KS_Block', { windowsHide: true, stdio: 'ignore', timeout: 1500 }); } catch (e) {}
    if (!(configEnMemoria.killSwitch && !app.isQuitting)) restaurarKillSwitchSincrono();

    const snapshot = cargarSnapshotProxyOriginal();
    if (snapshot && snapshot.values) {
        for (const name of PROXY_REGISTRY_VALUES) {
            emergencyOk = aplicarValorRegistro(name, snapshot.values[name]) && emergencyOk;
        }
        if (emergencyOk) {
            try { fs.unlinkSync(networkSnapshotPath); } catch (e) {}
        }
    } else if (huboProxyActivoAnteriormente()) {
        const currentServer = leerValorRegistro('ProxyServer');
        if (currentServer.exists && /^127\.0\.0\.1:\d+$/i.test(currentServer.data || '')) {
            emergencyOk = aplicarValorRegistro('ProxyEnable', { exists: true, type: 'REG_DWORD', data: '0' }) && emergencyOk;
            emergencyOk = aplicarValorRegistro('ProxyServer', { exists: false }) && emergencyOk;
        }
    }
    marcarProxyInactivo();

    if (emergencyOk && !fs.existsSync(networkSnapshotPath) && !fs.existsSync(firewallSnapshotPath) && !huboProxyActivoAnteriormente()) {
        marcarRedLimpia();
    }
}

function probarTcp(address, port, timeoutMs = 2500) {
    return new Promise(resolve => {
        const socket = new net.Socket();
        let done = false;
        const finish = ok => {
            if (done) return;
            done = true;
            try { socket.destroy(); } catch (_) {}
            resolve(ok);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
        try { socket.connect({ host: address, port }); } catch (_) { finish(false); }
    });
}

async function resolverIP(host, port = 443, { probeTcp = true } = {}) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return host;
    try {
        const entries = await Promise.race([
            dns.lookup(host, { all: true, verbatim: false }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('dns_timeout')), 5000))
        ]);
        const unique = [...new Map((entries || []).map(e => [e.address, e])).values()];
        // En redes móviles con IPv6 parcial, IPv4 suele ser el fallback más seguro.
        unique.sort((a, b) => (a.family === 4 ? 0 : 1) - (b.family === 4 ? 0 : 1));
        if (!unique.length) return null;
        if (!probeTcp) return unique[0].address;

        return await new Promise(resolve => {
            let pending = unique.length;
            let settled = false;
            unique.forEach((entry, index) => {
                setTimeout(async () => {
                    const ok = await probarTcp(entry.address, port, 2500);
                    pending -= 1;
                    if (ok && !settled) {
                        settled = true;
                        resolve(entry.address);
                    } else if (pending === 0 && !settled) {
                        settled = true;
                        resolve(null);
                    }
                }, index * 150);
            });
        });
    } catch {
        return null;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function leerLogSingbox() {
    try {
        if (fs.existsSync(singboxLogPath)) {
            return fs.readFileSync(singboxLogPath, 'utf8').trim();
        }
    } catch (e) {}
    return '';
}

function limpiarBuffersSingbox() {
    singboxStdErr = '';
    singboxStdOut = '';
}

function esperarSalidaProceso(child, timeoutMs) {
    if (!child || child.exitCode !== null) return Promise.resolve(true);

    return new Promise(resolve => {
        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.removeListener('exit', onExit);
            child.removeListener('close', onExit);
            resolve(value);
        };
        const onExit = () => finish(true);
        const timer = setTimeout(() => finish(false), timeoutMs);
        child.once('exit', onExit);
        child.once('close', onExit);
    });
}

async function detenerSingbox({ checkOrphans = false } = {}) {
    const child = proxyProcess;
    proxyProcess = null;
    let trackedExited = true;

    if (procesoVivo(child)) {
        const pid = child.pid;
        try { child.kill(); } catch (_) {}

        trackedExited = await esperarSalidaProceso(child, 450);
        if (!trackedExited && pid) {
            try {
                spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
                    windowsHide: true,
                    stdio: 'ignore',
                    timeout: 1800
                });
            } catch (_) {}
            trackedExited = await esperarSalidaProceso(child, 350);
        }
    }

    if (trackedExited && !checkOrphans) return true;
    if (!checkOrphans) return false;

    // Recuperación estricta: una única búsqueda global para procesos huérfanos.
    try {
        const running = spawnSync('tasklist', ['/FI', 'IMAGENAME eq sing-box.exe', '/FO', 'CSV', '/NH'], {
            windowsHide: true,
            encoding: 'utf8',
            timeout: 1800
        });
        if ((running.stdout || '').toLowerCase().includes('sing-box.exe')) {
            spawnSync('taskkill', ['/IM', 'sing-box.exe', '/F', '/T'], {
                windowsHide: true,
                stdio: 'ignore',
                timeout: 1800
            });
            const after = spawnSync('tasklist', ['/FI', 'IMAGENAME eq sing-box.exe', '/FO', 'CSV', '/NH'], {
                windowsHide: true,
                encoding: 'utf8',
                timeout: 1800
            });
            return !(after.stdout || '').toLowerCase().includes('sing-box.exe');
        }
        return true;
    } catch (_) {
        return false;
    }
}

function errorMotorDetenido() {
    const detalle = [singboxStdErr.trim(), singboxStdOut.trim(), leerLogSingbox().trim()].filter(Boolean).join('\n');
    return new Error(`sing-box terminó antes de que el túnel estuviera listo.${detalle ? `\n${detalle}` : ''}`);
}

function asegurarMotorVivo() {
    if (!procesoVivo(proxyProcess)) throw errorMotorDetenido();
}

function esperarPuerto(host, port, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();

        const intentar = () => {
            try { asegurarMotorVivo(); } catch (e) { reject(e); return; }
            const socket = new net.Socket();
            let terminado = false;

            const cerrar = () => { try { socket.destroy(); } catch (e) {} };
            socket.setTimeout(1000);

            socket.connect(port, host, () => {
                if (terminado) return;
                terminado = true;
                cerrar();
                resolve(true);
            });

            const alFallar = () => {
                if (terminado) return;
                try { asegurarMotorVivo(); } catch (e) {
                    terminado = true;
                    cerrar();
                    reject(e);
                    return;
                }
                terminado = true;
                cerrar();
                if (Date.now() - start >= timeoutMs) {
                    reject(new Error(`Timeout esperando puerto ${host}:${port}`));
                } else {
                    setTimeout(intentar, 100);
                }
            };

            socket.on('error', alFallar);
            socket.on('timeout', alFallar);
        };

        intentar();
    });
}

async function esperarInterfazTun(nombreInterfaz, timeoutMs = 30000) {
    const inicio = Date.now();
    const buscado = nombreInterfaz.toLowerCase();
    let iteracion = 0;

    while (Date.now() - inicio < timeoutMs) {
        asegurarMotorVivo();

        // os.networkInterfaces() evita crear un proceso netsh en cada sondeo.
        try {
            const nombres = Object.keys(os.networkInterfaces());
            if (nombres.some(name => name.toLowerCase() === buscado)) return true;
        } catch (_) {}

        // Fallback ocasional: algunas versiones de Windows tardan en exponer el TUN a Node.
        if (iteracion % 8 === 7) {
            try {
                const resultado = await ejecutarComandoCapturando('netsh', ['interface', 'show', 'interface'], { timeoutMs: 2500 });
                if ((resultado.stdout || '').toLowerCase().includes(buscado)) return true;
            } catch (_) {}
        }

        iteracion += 1;
        await sleep(80);
    }
    return false;
}

function ejecutarComandoCapturando(cmd, args = [], options = {}) {
    return new Promise((resolve, reject) => {
        const { timeoutMs = 15000, ...spawnOptions } = options;
        let timer = null;
        let settled = false;

        try {
            const child = spawn(cmd, args, { windowsHide: true, ...spawnOptions });
            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (data) => { stdout += data.toString(); });
            child.stderr?.on('data', (data) => { stderr += data.toString(); });
            child.once('error', (err) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                reject(err);
            });
            child.once('close', (code) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                resolve({ code, stdout, stderr });
            });

            timer = setTimeout(() => {
                if (settled) return;
                try { child.kill(); } catch (e) {}
                try {
                    if (process.platform === 'win32' && child.pid) {
                        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
                    }
                } catch (e) {}
            }, timeoutMs);
        } catch (err) {
            if (timer) clearTimeout(timer);
            reject(err);
        }
    });
}

function compararVersiones(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        const av = a[i] || 0;
        const bv = b[i] || 0;
        if (av !== bv) return av > bv ? 1 : -1;
    }
    return 0;
}

function validarMotorLX() {
    if (!fs.existsSync(singboxPath)) throw new Error('sing-box-lx_missing');

    let signature = '';
    try {
        const stat = fs.statSync(singboxPath);
        signature = `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
    } catch (_) {}

    if (motorLXValidationCache && motorLXValidationCache.signature === signature) {
        return motorLXValidationCache.version;
    }

    const result = spawnSync(singboxPath, ['version'], {
        cwd: rutaBinarios,
        windowsHide: true,
        encoding: 'utf8',
        timeout: 8000
    });
    if (result.error) throw new Error(`sing-box-lx_missing: ${result.error.message}`);
    const text = `${result.stdout || ''}\n${result.stderr || ''}`;
    const match = text.match(/(?:sing-box(?:-lx)?\s+version\s+)?(\d+)\.(\d+)\.(\d+)-lx\.(\d+)/i);
    if (!match) throw new Error(`sing-box-lx_required: ${text.trim()}`);
    const base = [Number(match[1]), Number(match[2]), Number(match[3])];
    const lx = Number(match[4]);
    const cmp = compararVersiones(base, [1, 14, 1]);
    if (cmp < 0 || (cmp === 0 && lx < 4)) throw new Error(`sing-box-lx_too_old: ${match[0]}`);

    const version = `${match[1]}.${match[2]}.${match[3]}-lx.${match[4]}`;
    motorLXValidationCache = { signature, version };
    return version;
}

function comprobarConfigConMotor(configPath) {
    const result = spawnSync(singboxPath, ['check', '-c', configPath], {
        cwd: rutaBinarios,
        windowsHide: true,
        encoding: 'utf8',
        timeout: 15000
    });
    if (result.error || result.status !== 0) {
        const detail = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        throw new Error(`config_check_failed: ${detail}`);
    }
}

async function iniciarSingbox(configPath) {
    await detenerSingbox();
    limpiarBuffersSingbox();
    validarMotorLX();
    comprobarConfigConMotor(configPath);

    try { if (fs.existsSync(singboxLogPath)) fs.writeFileSync(singboxLogPath, ''); } catch (_) {}

    return new Promise((resolve, reject) => {
        let settled = false;
        const fail = error => {
            if (settled) return;
            settled = true;
            proxyProcess = null;
            reject(error);
        };

        try {
            proxyProcess = spawn(singboxPath, ['run', '-c', configPath], {
                cwd: rutaBinarios,
                windowsHide: true,
                env: { ...process.env }
            });
        } catch (err) {
            proxyProcess = null;
            reject(new Error(`No se pudo lanzar sing-box-lx: ${err.message}`));
            return;
        }

        proxyProcess.stdout?.on('data', data => { singboxStdOut += data.toString(); });
        proxyProcess.stderr?.on('data', data => { singboxStdErr += data.toString(); });

        proxyProcess.once('error', err => {
            fail(new Error(`Error iniciando sing-box-lx: ${err.message}`));
        });

        // No esperamos un timeout fijo: desde aquí el readiness real lo decide
        // el puerto/TUN y luego el health-check end-to-end.
        proxyProcess.once('spawn', () => {
            if (settled) return;
            settled = true;
            resolve(true);
        });

        proxyProcess.once('exit', (code, signal) => {
            if (settled) return;
            const logTxt = leerLogSingbox();
            const detalle = [singboxStdErr.trim(), logTxt.trim()].filter(Boolean).join('\n');
            fail(new Error(`sing-box terminó inmediatamente (code=${code}, signal=${signal || 'null'})\n${detalle}`));
        });
    });
}

function borrarConfigTemporal() {
    try { if (fs.existsSync(configJsonPath)) fs.unlinkSync(configJsonPath); } catch (_) {}
}

async function probarSaludTunel() {
    const urls = [
        'https://detectportal.firefox.com/success.txt',
        'https://www.msftconnecttest.com/connecttest.txt',
        'https://captive.apple.com/hotspot-detect.html'
    ];
    const errores = [];
    for (const url of urls) {
        const args = ['-L', '-sS', '--connect-timeout', '4', '--max-time', '8', '-o', 'NUL', '-w', '%{http_code}'];
        if (configEnMemoria.connectionMode === 'proxy') args.push('--proxy', `http://127.0.0.1:${puertoStealthLocal}`);
        args.push(url);
        try {
            const r = await ejecutarComandoCapturando('curl.exe', args, { timeoutMs: 10000 });
            const code = Number.parseInt(String(r.stdout || '').trim().slice(-3), 10);
            if (r.code === 0 && code >= 200 && code < 400) return true;
            errores.push(`${url}: code=${r.code}, http=${code || 0}, ${r.stderr || ''}`);
        } catch (e) {
            errores.push(`${url}: ${e.message || e}`);
        }
    }
    throw new Error(`health_check_failed: ${errores.join(' | ')}`);
}

function iniciarMonitorSingbox() {
    if (monitorInterval) clearInterval(monitorInterval);

    monitorInterval = setInterval(async () => {
        if (!isVpnConnected || desconexionManual || monitorRecoveryInProgress) return;

        try {
            if (!proxyProcess || proxyProcess.killed || proxyProcess.exitCode !== null) {
                monitorRecoveryInProgress = true;
                isVpnConnected = false;
                clearInterval(monitorInterval);
                monitorInterval = null;

                const detalle = leerLogSingbox() || singboxStdErr || 'El motor VPN se detuvo.';
                registrarErrorApp('monitor-singbox', detalle);

                const preserve = Boolean(configEnMemoria.killSwitch);
                await restaurarRedWindows('sing-box-crash', { preserveKillSwitch: preserve });

                if (mainWindow && !mainWindow.isDestroyed()) {
                    const msgBase = resumirErrorParaUI('sing-box terminó inmediatamente', configEnMemoria.connectionMode);
                    mainWindow.webContents.send('error-suscripcion', (preserve ? t('conn-lost-blocked') : t('conn-lost')) + ' ' + msgBase);
                }
            }
        } catch (e) {
            registrarErrorApp('monitor-singbox-exception', e.stack || e.message || String(e));
            try { await restaurarRedWindows('monitor-exception', { preserveKillSwitch: Boolean(configEnMemoria.killSwitch) }); } catch (_) {}
        } finally {
            monitorRecoveryInProgress = false;
        }
    }, 3000);
}

function guardarReachabilityCache(id, node, ip, ping, probe, estado) {
    if (!id || !node) return;
    if (!ip) {
        reachabilityCache.delete(id);
        return;
    }
    reachabilityCache.set(id, {
        host: node.host,
        port: node.port,
        protocol: node.protocol,
        ip,
        ping,
        probe,
        estado,
        at: Date.now()
    });
}

function obtenerIpRadarReciente(id, node) {
    const cached = reachabilityCache.get(id);
    if (!cached || !node) return null;
    if (Date.now() - cached.at > REACHABILITY_CACHE_TTL_MS) {
        reachabilityCache.delete(id);
        return null;
    }
    if (cached.host !== node.host || Number(cached.port) !== Number(node.port) || cached.protocol !== node.protocol) {
        reachabilityCache.delete(id);
        return null;
    }
    return cached.ip || null;
}

// ==========================================
// CANALES IPC DE COMUNICACIÓN CORE
// ==========================================
trustedIpcOn('ping-servers', async (event) => {
    const resultados = {};
    const entries = Object.entries(configEnMemoria.servidores || {});
    await Promise.all(entries.map(async ([id, srv]) => {
        const node = protocols.parseNodeUri(srv.uri || '');
        if (!node) {
            resultados[id] = { estado: 'url_error', ping: -1, probe: 'none' };
            return;
        }
        if (protocols.isUdpNativeProtocol(node)) {
            const start = Date.now();
            const resolved = await resolverIP(node.host, node.port, { probeTcp: false });
            const ping = resolved ? Date.now() - start : -1;
            const estado = resolved ? 'resolved' : 'down';
            resultados[id] = { estado, ping, probe: 'dns' };
            guardarReachabilityCache(id, node, resolved, ping, 'dns', estado);
            return;
        }
        const start = Date.now();
        const resolved = await resolverIP(node.host, node.port, { probeTcp: true });
        const ping = resolved ? Date.now() - start : -1;
        let estado = 'optimal';
        if (ping >= 200 && ping <= 800) estado = 'high_latency';
        if (ping > 800) estado = 'overloaded';
        if (!resolved) estado = 'down';
        resultados[id] = { estado, ping, probe: 'tcp' };
        guardarReachabilityCache(id, node, resolved, ping, 'tcp', estado);
    }));
    event.reply('ping-results', resultados);
});

trustedIpcOn('sincronizar-banderas', async (event, listaIso) => {
    try {
        const mapa = await flags.sincronizarBanderas(listaIso);
        event.reply('banderas-listas', mapa);
    } catch (e) {
        registrarErrorApp('sincronizar-banderas', e.message || String(e));
        event.reply('banderas-listas', {});
    }
});

function mapaServidoresDesdeNodos(nodos) {
    reachabilityCache.clear();
    const out = {};
    for (const node of nodos || []) {
        out[node.id] = { ...protocols.sanitizeNode(node), uri: node.raw };
    }
    return out;
}

trustedIpcOn('activar-suscripcion', async (event, payload) => {
    const subUrl = (payload && payload.subUrl ? payload.subUrl : '').trim();
    if (!subUrl) return event.reply('suscripcion-error', t('sub-empty'));

    const resultado = await subscription.obtenerSuscripcion(subUrl);
    if (!resultado.ok) return event.reply('suscripcion-error', mapearErrorSub(resultado.error));

    try {
        configEnMemoria.subUrlCifrada = subscription.cifrarSubUrl(subUrl);
        configEnMemoria.servidores = mapaServidoresDesdeNodos(resultado.servidores);
        configEnMemoria.expiraSub = resultado.expira;
        configEnMemoria.traficoSub = resultado.trafico;
        configEnMemoria.tituloSub = resultado.titulo;
        configEnMemoria.ultimoServidor = Object.keys(configEnMemoria.servidores)[0] || '';
        persistirSettings();
    } catch (e) {
        registrarErrorApp('subscription-secure-store', e.message || String(e));
        return event.reply('suscripcion-error', resumirErrorParaUI(e.message));
    }
    event.reply('suscripcion-exito', {
        servidores: servidoresPublicos(), expira: resultado.expira,
        trafico: resultado.trafico, titulo: resultado.titulo
    });
});

trustedIpcOn('refrescar-suscripcion', async (event) => {
    const subUrl = subscription.descifrarSubUrl(configEnMemoria.subUrlCifrada);
    if (!subUrl) return event.reply('suscripcion-error', t('sub-none'));

    const resultado = await subscription.obtenerSuscripcion(subUrl);
    if (!resultado.ok) {
        return event.reply('suscripcion-refrescada', {
            servidores: servidoresPublicos(), expira: configEnMemoria.expiraSub,
            trafico: configEnMemoria.traficoSub, titulo: configEnMemoria.tituloSub, offline: true
        });
    }

    try {
        configEnMemoria.servidores = mapaServidoresDesdeNodos(resultado.servidores);
        configEnMemoria.expiraSub = resultado.expira;
        configEnMemoria.traficoSub = resultado.trafico;
        configEnMemoria.tituloSub = resultado.titulo;
        if (!configEnMemoria.servidores[configEnMemoria.ultimoServidor]) {
            configEnMemoria.ultimoServidor = Object.keys(configEnMemoria.servidores)[0] || '';
        }
        persistirSettings();
    } catch (e) {
        registrarErrorApp('subscription-refresh-store', e.message || String(e));
    }
    event.reply('suscripcion-refrescada', {
        servidores: servidoresPublicos(), expira: resultado.expira,
        trafico: resultado.trafico, titulo: resultado.titulo, offline: false
    });
});

trustedIpcOn('borrar-suscripcion', () => {
    configEnMemoria.subUrlCifrada = '';
    configEnMemoria.servidores = {};
    configEnMemoria.expiraSub = 0;
    configEnMemoria.traficoSub = { upload: 0, download: 0, total: 0 };
    configEnMemoria.tituloSub = 'Arrow VPN';
    configEnMemoria.ultimoServidor = '';
    try { persistirSettings(); } catch (e) { registrarErrorApp('subscription-delete-store', e.message || String(e)); }
});

function generarConfigSingbox(nodeUri, nodeIP) {
    try {
        const node = protocols.parseNodeUri(nodeUri);
        if (!node) throw new Error('unsupported_node');
        const proxyOutbound = protocols.buildProxyOutbound(node, nodeIP);

        try { fs.writeFileSync(singboxLogPath, ''); } catch (_) {}
        puertoStealthLocal = Math.floor(Math.random() * (60000 - 10000 + 1)) + 10000;
        const nodeCIDR = nodeIP.includes(':') ? `${nodeIP}/128` : `${nodeIP}/32`;

        const config = {
            // Keep connection diagnostics without creating a local browsing-history style log.
            log: { level: 'warn', output: singboxLogPath },
            dns: {
                reverse_mapping: true,
                servers: [
                    { type: 'local', tag: 'dns-local' },
                    { type: 'https', tag: 'dns-remote-v4', server: '1.1.1.1', server_port: 443, path: '/dns-query', detour: 'proxy' },
                    { type: 'https', tag: 'dns-remote-v6', server: '2606:4700:4700::1111', server_port: 443, path: '/dns-query', detour: 'proxy' }
                ],
                final: 'dns-remote-v4'
            },
            inbounds: [],
            outbounds: [proxyOutbound, { type: 'direct', tag: 'direct' }],
            route: {
                auto_detect_interface: true,
                final: 'proxy',
                default_domain_resolver: 'dns-local',
                rules: [
                    { ip_cidr: ['127.0.0.0/8', '::1/128', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '224.0.0.0/4', '255.255.255.255/32', 'fc00::/7', 'fe80::/10', 'ff00::/8'], action: 'route', outbound: 'direct' },
                    { ip_cidr: [nodeCIDR], action: 'route', outbound: 'direct' }
                ]
            }
        };

        if (configEnMemoria.connectionMode === 'proxy') {
            config.inbounds = [{ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: puertoStealthLocal }];
        } else {
            config.inbounds = [{
                type: 'tun', tag: 'tun-in', interface_name: 'ArrowTUN', mtu: 1500,
                address: ['172.19.0.2/24', 'fdfe:dcba:9876::2/64'],
                auto_route: true, strict_route: true, stack: 'system'
            }];
        }

        fs.writeFileSync(configJsonPath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
        return true;
    } catch (e) {
        registrarErrorApp('generar-config-singbox', e.stack || e.message || String(e));
        try { if (fs.existsSync(configJsonPath)) fs.unlinkSync(configJsonPath); } catch (_) {}
        return false;
    }
}

trustedIpcOn('conectar-vpn', async (event, payload) => {
    if (networkState !== 'DISCONNECTED') {
        registrarErrorApp('connect-busy', `Estado actual: ${networkState}`);
        return event.reply('error-suscripcion', resumirErrorParaUI('Operación de red en curso', configEnMemoria.connectionMode));
    }

    // Solo pagamos el coste de una recuperación completa si una sesión anterior
    // dejó marcadores persistentes de red.
    if (hayArtefactosPersistentes()) {
        await restaurarRedWindows('pre-connect-recovery');
    }

    if (networkState !== 'DISCONNECTED') {
        return event.reply('error-suscripcion', resumirErrorParaUI('Operación de red en curso', configEnMemoria.connectionMode));
    }

    const perf = crearTrazaRendimiento('connect');
    setNetworkState('CONNECTING', 'user-connect');
    desconexionManual = false;

    let serverId = '';
    try {
        serverId = payload?.serverId || '';
        const selected = serverId ? configEnMemoria.servidores?.[serverId] : null;
        if (!selected?.uri) throw new Error('Llave del nodo inválida.');
        const node = protocols.parseNodeUri(selected.uri);
        if (!node) throw new Error('invalid_node_uri');

        validarMotorLX();
        perf.mark('engine validated');

        configEnMemoria.ultimoServidor = serverId;
        persistirSettings({ persistServers: false });

        if (configEnMemoria.expiraSub && configEnMemoria.expiraSub > 0 && Math.floor(Date.now() / 1000) >= configEnMemoria.expiraSub) {
            throw new Error('Suscripción expirada');
        }

        const cachedIP = obtenerIpRadarReciente(serverId, node);
        const nodeIP = cachedIP || await resolverIP(node.host, node.port, { probeTcp: !protocols.isUdpNativeProtocol(node) });
        perf.mark(cachedIP ? 'node address reused from radar' : 'node address resolved');

        if (networkState !== 'CONNECTING') throw new Error('connection_cancelled');
        if (!nodeIP) throw new Error('dns: server unreachable');

        if (!generarConfigSingbox(selected.uri, nodeIP)) throw new Error('config_generation_failed');
        perf.mark('config generated');

        await prepararRedAntesDeConexion();
        perf.mark('windows network prepared');

        if (networkState !== 'CONNECTING') throw new Error('connection_cancelled');
        if (configEnMemoria.killSwitch) {
            await activarKillSwitchBase();
            perf.mark('kill switch enabled');
        }

        await iniciarSingbox(configJsonPath);
        perf.mark('engine launched');

        if (networkState !== 'CONNECTING') throw new Error('connection_cancelled');

        if (configEnMemoria.connectionMode === 'proxy') {
            await esperarPuerto('127.0.0.1', puertoStealthLocal, 8000);
            borrarConfigTemporal();
            perf.mark('local proxy ready');

            if (networkState !== 'CONNECTING') throw new Error('connection_cancelled');
            await activarProxySistema();
            perf.mark('system proxy enabled');
        } else {
            const interfazLista = await esperarInterfazTun('ArrowTUN', 30000);
            if (!interfazLista) throw new Error('El adaptador TUN no apareció a tiempo.');
            borrarConfigTemporal();
            perf.mark('TUN ready');

            if (networkState !== 'CONNECTING') throw new Error('connection_cancelled');
            if (configEnMemoria.killSwitch) await permitirTunKillSwitch();
            await aplicarConfiguracionTun();
            perf.mark('TUN configured');

            if (networkState !== 'CONNECTING') throw new Error('connection_cancelled');
        }

        await probarSaludTunel();
        perf.mark('health check passed');

        if (networkState !== 'CONNECTING') throw new Error('connection_cancelled');

        isVpnConnected = true;
        setNetworkState('CONNECTED', 'connection-ready');
        iniciarMonitorSingbox();
        perf.done();
        event.reply('vpn-conectada-exito');
    } catch (e) {
        isVpnConnected = false;
        if (serverId) reachabilityCache.delete(serverId);
        const cancelled = String(e?.message || '').includes('connection_cancelled');
        borrarConfigTemporal();
        await restaurarRedWindows(cancelled ? 'connection-cancelled' : 'connection-failed');
        perf.done(cancelled ? 'cancelled' : 'failed');

        const detalle = [e?.message, singboxStdErr.trim(), singboxStdOut.trim(), leerLogSingbox()].filter(Boolean).join('\n');
        registrarErrorApp('conectar-vpn', detalle);
        if (!cancelled) event.reply('error-suscripcion', resumirErrorParaUI(detalle, configEnMemoria.connectionMode));
    }
});

trustedIpcOn('desconectar-vpn', async (event) => {
    if (networkState === 'DISCONNECTED') {
        event.reply('vpn-desconectada-exito');
        return;
    }

    const perf = crearTrazaRendimiento('disconnect');
    desconexionManual = true;
    isVpnConnected = false;
    setNetworkState('DISCONNECTING', 'user-disconnect');

    try {
        await restaurarRedWindows('user-disconnect');
    } catch (e) {
        registrarErrorApp('disconnect-cleanup', e.stack || e.message || String(e));
    } finally {
        perf.done();
        event.reply('vpn-desconectada-exito');
    }
});

trustedIpcOn('cerrar-ventana', () => { mainWindow.close(); });
trustedIpcOn('minimizar-ventana', () => { mainWindow.minimize(); });

// ==========================================
// CIERRE / CRASH: limpieza determinista antes de abandonar Windows
// ==========================================
app.on('before-quit', (event) => {
    app.isQuitting = true;
    if (quitCleanupDone) return;

    // Camino rápido: si la red ya está limpia, no lanzamos PowerShell/tasklist
    // y dejamos que Electron termine inmediatamente.
    if (!necesitaLimpiezaActiva()) {
        quitCleanupDone = true;
        return;
    }

    event.preventDefault();
    if (quitCleanupInProgress) return;

    quitCleanupInProgress = true;
    ocultarInterfazParaSalida();
    const perf = crearTrazaRendimiento('quit');

    (async () => {
        try {
            await restaurarRedWindows('app-quit');
        } catch (e) {
            registrarErrorApp('quit-cleanup', e.stack || e.message || String(e));
        } finally {
            quitCleanupDone = true;
            quitCleanupInProgress = false;
            perf.done();
            app.quit();
        }
    })();
});

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => {
    process.on(sig, () => {
        if (fatalCleanupInProgress) return;
        fatalCleanupInProgress = true;
        const forceTimer = setTimeout(() => process.exit(0), 7000);
        forceTimer.unref?.();
        restaurarRedWindows(`signal-${sig}`)
            .catch(() => {})
            .finally(() => process.exit(0));
    });
});

process.on('exit', () => {
    // En 'exit' ya no se pueden esperar Promises. Solo actuamos si quedó algo sucio;
    // un cierre normal y limpio no debe pagar otro ciclo de PowerShell/taskkill.
    if (quitCleanupDone || !necesitaLimpiezaActiva()) return;
    try { restaurarRedWindowsSincronoEmergencia(); } catch (e) {}
});

process.on('uncaughtException', (err) => {
    try { registrarErrorApp('uncaught-exception', err.stack || err.message || String(err)); } catch (e) {}
    if (fatalCleanupInProgress) return;
    fatalCleanupInProgress = true;

    const forceTimer = setTimeout(() => process.exit(1), 7000);
    forceTimer.unref?.();
    restaurarRedWindows('uncaught-exception')
        .catch(() => {})
        .finally(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
    try { registrarErrorApp('unhandled-rejection', reason && reason.stack ? reason.stack : String(reason)); } catch (e) {}
});

app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    try { mainWindow.webContents.send('app-toast', t('msg-already-running')); } catch (e) {}
});

trustedIpcOn('get-settings', (event) => { event.reply('load-settings', settingsPublicos()); });

trustedIpcOn('save-settings', async (_event, data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const allowed = ['tray', 'autoConnect', 'killSwitch', 'connectionMode', 'idioma'];
    const idiomaAnterior = configEnMemoria.idioma;
    const killAnterior = configEnMemoria.killSwitch;
    for (const key of allowed) {
        if (Object.hasOwn(data, key)) configEnMemoria[key] = data[key];
    }
    try { persistirSettings({ persistServers: false }); }
    catch (e) { registrarErrorApp('settings-store', e.message || String(e)); }

    if (data.idioma && data.idioma !== idiomaAnterior) aplicarMenuTray();
    if (killAnterior && data.killSwitch === false) {
        try { await restaurarKillSwitch(); } catch (e) { registrarErrorApp('killswitch-disable', e.message || String(e)); }
    }
});

trustedIpcOn('get-app-version', (event) => { event.reply('app-version', app.getVersion()); });

trustedIpcOn('copiar-suscripcion', (event) => {
    try {
        const subUrl = subscription.descifrarSubUrl(configEnMemoria.subUrlCifrada);
        if (!subUrl) return event.reply('suscripcion-copiada', { ok: false });
        clipboard.writeText(subUrl);
        event.reply('suscripcion-copiada', { ok: true });
    } catch (e) {
        registrarErrorApp('copiar-suscripcion', e.message || String(e));
        event.reply('suscripcion-copiada', { ok: false });
    }
});

trustedIpcOn('copiar-nodo', (event, payload) => {
    try {
        const id = payload?.serverId;
        const uri = id ? configEnMemoria.servidores?.[id]?.uri : '';
        if (!uri) return event.reply('nodo-copiado', { ok: false });
        clipboard.writeText(uri);
        event.reply('nodo-copiado', { ok: true, serverId: id });
    } catch (e) {
        registrarErrorApp('copiar-nodo', e.message || String(e));
        event.reply('nodo-copiado', { ok: false });
    }
});

function createTray() {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 24 }));
    aplicarMenuTray();
    tray.on('double-click', () => mainWindow.show());
}

function aplicarMenuTray() {
    if (!tray || tray.isDestroyed()) return;
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: t('tray-show'), click: () => mainWindow.show() },
        { type: 'separator' },
        { label: t('tray-quit'), click: () => { app.isQuitting = true; app.quit(); } }
    ]));
}

// ============================================================
// RECEPTORES DEL SISTEMA OTA v3
// ============================================================
autoUpdater.on('checking-for-update', () => { console.log('[OTA] checking-for-update'); });

autoUpdater.on('update-available', (info) => {
    console.log('[OTA] update-available:', info.version);
    ota_updateInfo = info;

    if (ota_silentProviderRefresh) {
        log.info(`[OTA] metadata refrescada silenciosamente para ${info.version}`);
        return;
    }

    ota_downloaded = false;
    ota_downloadInProgress = false;
    if (mainWindow) {
        mainWindow.webContents.send('ota:available', {
            version: info.version,
            releaseDate: info.releaseDate,
            currentVersion: app.getVersion(),
            source: OTA_UPDATE_SOURCES[ota_activeSourceIndex].id,
        });
    }
});

autoUpdater.on('update-not-available', (info) => {
    console.log('[OTA] update-not-available. Cliente ya en la última versión.');
    if (ota_silentProviderRefresh) return;
    if (mainWindow) mainWindow.webContents.send('ota:not-available', { currentVersion: app.getVersion() });
});

autoUpdater.on('download-progress', (progress) => {
    if (mainWindow) {
        mainWindow.webContents.send('ota:progress', {
            percent: Math.round(progress.percent || 0),
            bytesPerSecond: progress.bytesPerSecond || 0,
            transferred: progress.transferred || 0,
            total: progress.total || 0,
        });
    }
});

autoUpdater.on('update-downloaded', (info) => {
    console.log('[OTA] update-downloaded:', info.version);
    ota_downloaded = true;
    ota_downloadInProgress = false;

    if (mainWindow) {
        mainWindow.webContents.send('ota:downloaded', {
            version: info.version,
        });
    }
});

autoUpdater.on('error', (err) => {
    console.log('[OTA] error:', err && err.message);
    registrarErrorApp('auto-updater', err.stack || err.message || String(err));

    // Durante el failover un error de un mirror es interno: sólo se informa al
    // usuario si todos los mirrors terminan fallando.
    if (ota_failoverActive) {
        log.warn('[OTA] error suprimido mientras se intenta el siguiente mirror');
        return;
    }

    ota_downloadInProgress = false;
    if (mainWindow) mainWindow.webContents.send('ota:error', { message: (err && err.message) || String(err) });
});

// -------- Handlers IPC del renderer → main --------
trustedIpcOn('ota-check', async () => {
    console.log('[OTA] IPC ota-check');
    try {
        await comprobarActualizacionConFailover('ipc-manual');
    } catch (err) {
        console.log('[OTA] checkForUpdates fallo:', err.message);
        if (mainWindow) mainWindow.webContents.send('ota:error', { message: err.message });
    }
});

trustedIpcOn('ota-download', async () => {
    console.log('[OTA] IPC ota-download');
    if (ota_downloadInProgress) return;
    if (!ota_updateInfo) {
        if (mainWindow) mainWindow.webContents.send('ota:error', { message: 'No update info available' });
        return;
    }
    ota_downloadInProgress = true;
    try {
        await autoUpdater.downloadUpdate();
    } catch (err) {
        ota_downloadInProgress = false;
        if (mainWindow) mainWindow.webContents.send('ota:error', { message: err.message });
    }
});

// Restaurado: Uso limpio del método nativo quitAndInstall
trustedIpcOn('ota-install-restart', async () => {
    console.log('[OTA] IPC ota-install-restart');

    if (!ota_downloaded) {
        console.log('[OTA] update aún no descargado, ignoro');
        return;
    }

    try {
        await restaurarRedWindows('ota-install');
    } catch (e) {
        registrarErrorApp('ota-network-cleanup', e.stack || e.message || String(e));
        try { restaurarRedWindowsSincronoEmergencia(); } catch (_) {}
    }

    try {
        app.releaseSingleInstanceLock();
    } catch (e) {}

    console.log('[OTA] Ejecutando quitAndInstall nativo...');

    // La red ya está restaurada: dejamos que electron-updater controle el cierre
    // sin que nuestro before-quit intercepte y vuelva a bloquear el instalador.
    quitCleanupDone = true;
    app.isQuitting = true;

    autoUpdater.quitAndInstall(false, true);
});

function limpiarAccesosDirectosFantasma() {
    try {
        const userStartMenu = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Arrow VPN.lnk');
        const userMenuFolder = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Arrow VPN');

        if (fs.existsSync(userStartMenu)) fs.unlinkSync(userStartMenu);
        if (fs.existsSync(userMenuFolder)) fs.rmSync(userMenuFolder, { recursive: true, force: true });
    } catch (e) {
        registrarErrorApp('limpiar-accesos-directos', e.stack || e.message || String(e));
    }
}

app.whenReady().then(async () => {
    configEnMemoria = getSettings();
    try { persistirSettings(); } catch (e) { registrarErrorApp('startup-secure-store', e.message || String(e)); }
    asegurarIdiomaInicial();
    try { if (fs.existsSync(configJsonPath)) fs.unlinkSync(configJsonPath); } catch (_) {}
    limpiarAccesosDirectosFantasma();

    // Fast startup: solo ejecutamos recuperación pesada si existen marcadores de
    // una sesión anterior incompleta. Un cierre limpio abre la UI sin PowerShell.
    try {
        if (hayArtefactosPersistentes()) {
            registrarErrorApp('startup-recovery', 'Se detectó una sesión anterior sin limpieza completa. Restaurando red.');
            await restaurarRedWindows('startup');
        } else {
            networkTouchedThisSession = false;
            setNetworkState('DISCONNECTED', 'startup-clean');
        }
    } catch (e) {
        registrarErrorApp('startup-recovery-fail', e.stack || e.message || String(e));
        try { restaurarRedWindowsSincronoEmergencia(); } catch (_) {}
        setNetworkState('DISCONNECTED', 'startup-fallback');
    }

    createWindow();
    createTray();

    // Calentamos la validación del motor cuando la UI ya está creada. Así el primer
    // Connect normalmente reutiliza el resultado cacheado sin bloquear la interacción.
    setTimeout(() => {
        try { validarMotorLX(); }
        catch (e) { registrarErrorApp('engine-warmup', e.message || String(e)); }
    }, 750);

    setTimeout(async () => {
        try {
            console.log('[OTA] chequeo inicial');
            await comprobarActualizacionConFailover('startup');
        } catch (err) {
            registrarErrorApp('startup-ota', err.stack || err.message || String(err));
        }
    }, 3000);

    setInterval(async () => {
        try { await comprobarActualizacionConFailover('periodic'); } catch (err) { console.log('[OTA] chequeo periódico fallo:', err.message); }
    }, 60 * 60 * 1000);
});