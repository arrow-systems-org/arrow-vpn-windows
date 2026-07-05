const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, session, clipboard } = require('electron');
const Store = require('electron-store');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const os = require('os');
const net = require('net');
const subscription = require('./subscription');
const flags = require('./flags');

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

const { autoUpdater } = require('electron-updater');

// Evitar caché del latest.yml
autoUpdater.requestHeaders = { "Cache-Control": "no-cache" };

// Control MANUAL del ciclo (no auto-download, no auto-install al cierre)
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

// Log completo a %APPDATA%\arrow-vpn\logs\main.log
try {
    const log = require('electron-log');
    log.transports.file.level = 'info';
    log.transports.file.fileName = 'main.log';
    autoUpdater.logger = log;
    log.info('[OTA] logger inicializado. Version app:', app.getVersion());
} catch (e) {
    console.log('[OTA] electron-log no disponible:', e.message);
}

// Referencias globales para el ciclo de update
let ota_updateInfo = null;       // { version, releaseDate, ... } cuando hay update
let ota_downloadInProgress = false;
let ota_downloaded = false;
const dns = require('dns').promises;
const dnsSync = require('dns');

dnsSync.setServers(['1.1.1.1', '2606:4700:4700::1111']);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const store = new Store({ name: 'arrow_credenciales' });

let tray = null;
let mainWindow = null;
let proxyProcess = null;
let desconexionManual = false;
let isVpnConnected = false;
let monitorInterval = null;
let singboxStdErr = '';
let singboxStdOut = '';

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

const proxyFlagPath = path.join(app.getPath('userData'), 'proxy_active.flag');

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
function getSettings() {
    const saved = store.get('userSettings') || {};

    return {
        subUrlCifrada: saved.subUrlCifrada || '',
        servidores: saved.servidores || {},
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
        store.set('userSettings', configEnMemoria);
        console.log(`[i18n] Idioma autodetectado en primera apertura: ${detectado}`);
    }
}

configEnMemoria = getSettings();

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
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindow.loadFile('index.html');

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

    if (txt.includes('timeout esperando puerto')) {
        return modo === 'proxy' ? t('err-proxy-local') : t('err-vpn-internal');
    }
    if (txt.includes('adaptador tun')) {
        return t('err-vpn-adapter');
    }
    if (txt.includes('dns')) {
        return t('err-dns');
    }
    if (txt.includes('llave del nodo')) {
        return t('err-node-config');
    }
    if (txt.includes('suscripción')) {
        return t('err-subscription');
    }
    if (txt.includes('sing-box terminó inmediatamente')) {
        return t('err-engine-start');
    }
    if (txt.includes('no se pudo lanzar sing-box') || txt.includes('error iniciando sing-box')) {
        return t('err-engine');
    }

    return modo === 'proxy' ? t('err-proxy-start') : t('err-vpn-start');
}

function mapearErrorSub(codigo) {
    switch (codigo) {
        case 'timeout':       return t('sub-err-timeout');
        case 'network':       return t('sub-err-network');
        case 'invalid_url':   return t('sub-err-invalid-url');
        case 'no_servers':    return t('sub-err-no-servers');
        default:
            if (String(codigo).startsWith('http_')) {
                return t('sub-err-http');
            }
            return t('sub-err-generic');
    }
}

function refrescarProxyWindows() {
    try {
        const scriptPath = path.join(app.getPath('userData'), 'refresh_proxy.ps1');

        const psCode = `
        $signature = @'
        [DllImport("wininet.dll", SetLastError = true, CharSet=CharSet.Auto)]
        public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
        '@
        $interopHelper = Add-Type -MemberDefinition $signature -Name "WinInetHelper" -Namespace "WinInet" -PassThru
        $interopHelper::InternetSetOption(0, 39, 0, 0) | Out-Null
        $interopHelper::InternetSetOption(0, 37, 0, 0) | Out-Null
        `;

        fs.writeFileSync(scriptPath, psCode);

        spawn(
            'powershell.exe',
            ['-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
            { windowsHide: true }
        );
    } catch (e) {}
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
        if (fs.existsSync(proxyFlagPath)) {
            fs.unlinkSync(proxyFlagPath);
        }
    } catch (e) {
        registrarErrorApp('marcar-proxy-inactivo', e.message || String(e));
    }
}

function huboProxyActivoAnteriormente() {
    try {
        return fs.existsSync(proxyFlagPath);
    } catch (e) {
        return false;
    }
}

// ==========================================
// LIMPIEZA AGRESIVA DEL PROXY DEL SISTEMA
// ==========================================
function limpiarProxySistemaAgresivo() {
    try {
        const p = session.defaultSession.setProxy({ proxyRules: 'direct://' });
        if (p && p.catch) p.catch(() => {});
    } catch (e) {}

    try {
        execSync('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f', { windowsHide: true, stdio: 'ignore' });
    } catch (e) {}

    try {
        execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /f', { windowsHide: true, stdio: 'ignore' });
    } catch (e) {}

    try {
        execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride /f', { windowsHide: true, stdio: 'ignore' });
    } catch (e) {}

    try {
        execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v AutoConfigURL /f', { windowsHide: true, stdio: 'ignore' });
    } catch (e) {}

    refrescarProxyWindows();
    marcarProxyInactivo();
}

function limpiarProxySistema() {
    try {
        const p = session.defaultSession.setProxy({ proxyRules: 'direct://' });
        if (p && p.catch) p.catch(() => {});
    } catch (e) {}

    try {
        spawn('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f'], { windowsHide: true });
    } catch (e) {}

    refrescarProxyWindows();
    marcarProxyInactivo();
}

function activarProxySistema() {
    try {
        const p = session.defaultSession.setProxy({
            proxyRules: `http=127.0.0.1:${puertoStealthLocal};https=127.0.0.1:${puertoStealthLocal}`
        });
        if (p && p.catch) p.catch(() => {});
    } catch (e) {}

    try {
        session.defaultSession.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    } catch (e) {}

    try {
        spawn('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f'], { windowsHide: true });
        spawn('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', `127.0.0.1:${puertoStealthLocal}`, '/f'], { windowsHide: true });
    } catch (e) {}

    refrescarProxyWindows();
    marcarProxyActivo(puertoStealthLocal, 'proxy');
}

function limpiarReglasFirewall() {
    try {
        spawn('netsh', ['advfirewall', 'firewall', 'delete', 'rule', 'name=Arrow_KS_Block'], { windowsHide: true });
    } catch (e) {}

    try {
        const psCleanupScriptPath = path.join(app.getPath('userData'), 'cleanup_dns.ps1');
        const psCleanupCommands = `
            Get-DnsClientNrptRule -ErrorAction SilentlyContinue | Where-Object {$_.Comment -eq 'ArrowVPN'} | Remove-DnsClientNrptRule -Force -ErrorAction SilentlyContinue
            Clear-DnsClientCache
            ipconfig /flushdns
        `;
        fs.writeFileSync(psCleanupScriptPath, psCleanupCommands);
        spawn('powershell.exe', ['-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', psCleanupScriptPath], { windowsHide: true });
    } catch (e) {}
}

async function resolverIP(host) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
        return host;
    }

    try {
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error('timeout')), 5000);
        });

        const ipv4Promise = dns.resolve4(host).catch(() => []);
        const ipv6Promise = dns.resolve6(host).catch(() => []);

        const [ipv4, ipv6] = await Promise.race([
            Promise.all([ipv4Promise, ipv6Promise]),
            timeoutPromise
        ]);

        clearTimeout(timeoutId);

        if (Array.isArray(ipv6) && ipv6.length > 0) return ipv6[0];
        if (Array.isArray(ipv4) && ipv4.length > 0) return ipv4[0];
        return null;
    } catch (err) {
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

function detenerSingbox() {
    return new Promise((resolve) => {
        try {
            if (proxyProcess && !proxyProcess.killed) {
                proxyProcess.kill();
            }
        } catch (e) {}

        proxyProcess = null;

        try {
            execSync('taskkill /IM sing-box.exe /F /T', { windowsHide: true, stdio: 'ignore' });
        } catch (e) {}

        setTimeout(resolve, 1500);
    });
}

function esperarPuerto(host, port, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();

        const intentar = () => {
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
                terminado = true;
                cerrar();
                if (Date.now() - start >= timeoutMs) {
                    reject(new Error(`Timeout esperando puerto ${host}:${port}`));
                } else {
                    setTimeout(intentar, 250);
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
    while (Date.now() - inicio < timeoutMs) {
        try {
            const resultado = await ejecutarComandoCapturando('netsh', ['interface', 'show', 'interface']);
            if ((resultado.stdout || '').toLowerCase().includes(nombreInterfaz.toLowerCase())) {
                return true;
            }
        } catch (e) {}
        await sleep(500);
    }
    return false;
}

function ejecutarComandoCapturando(cmd, args = [], options = {}) {
    return new Promise((resolve, reject) => {
        try {
            const child = spawn(cmd, args, { windowsHide: true, ...options });
            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (data) => { stdout += data.toString(); });
            child.stderr?.on('data', (data) => { stderr += data.toString(); });
            child.on('error', (err) => { reject(err); });
            child.on('close', (code) => { resolve({ code, stdout, stderr }); });
        } catch (err) {
            reject(err);
        }
    });
}

async function iniciarSingbox(configPath) {
    await detenerSingbox();
    limpiarBuffersSingbox();
    await sleep(2000);

    try {
        if (fs.existsSync(singboxLogPath)) fs.writeFileSync(singboxLogPath, '');
    } catch (e) {}

    return new Promise((resolve, reject) => {
        let resuelto = false;

        try {
            proxyProcess = spawn(singboxPath, ['run', '-c', configPath], {
                cwd: rutaBinarios,
                windowsHide: true,
                env: {
                    ...process.env,
                    ENABLE_DEPRECATED_LEGACY_DNS_SERVERS: 'true',
                    ENABLE_DEPRECATED_MISSING_DOMAIN_RESOLVER: 'true'
                }
            });
        } catch (err) {
            proxyProcess = null;
            reject(new Error(`No se pudo lanzar sing-box: ${err.message}`));
            return;
        }

        proxyProcess.stdout?.on('data', (data) => { console.log('[sing-box stdout]', data.toString()); });
        proxyProcess.stderr?.on('data', (data) => { singboxStdErr += data.toString(); });

        proxyProcess.once('error', (err) => {
            if (resuelto) return;
            resuelto = true;
            proxyProcess = null;
            reject(new Error(`Error iniciando sing-box: ${err.message}`));
        });

        proxyProcess.once('exit', (code, signal) => {
            if (resuelto) return;
            resuelto = true;
            proxyProcess = null;
            const logTxt = leerLogSingbox();
            const detalle = [singboxStdErr.trim(), logTxt.trim()].filter(Boolean).join('\n');
            reject(new Error(`sing-box terminó inmediatamente (code=${code}, signal=${signal || 'null'})\n${detalle}`));
        });

        setTimeout(() => {
            if (resuelto) return;
            resuelto = true;
            resolve(true);
        }, 1200);
    });
}

function iniciarMonitorSingbox() {
    if (monitorInterval) clearInterval(monitorInterval);

    monitorInterval = setInterval(() => {
        if (!isVpnConnected || desconexionManual) return;

        try {
            if (!proxyProcess || proxyProcess.killed || proxyProcess.exitCode !== null) {
                isVpnConnected = false;
                clearInterval(monitorInterval);
                monitorInterval = null;

                const detalle = leerLogSingbox() || singboxStdErr || 'El motor VPN se detuvo.';
                registrarErrorApp('monitor-singbox', detalle);

                if (mainWindow && !mainWindow.isDestroyed()) {
                    const msgBase = resumirErrorParaUI('sing-box terminó inmediatamente', configEnMemoria.connectionMode);
                    mainWindow.webContents.send('error-suscripcion', configEnMemoria.killSwitch ? `${t('conn-lost-blocked')} ${msgBase}` : `${t('conn-lost')} ${msgBase}`);
                }
            }
        } catch (e) {
            registrarErrorApp('monitor-singbox-exception', e.message || String(e));
        }
    }, 3000);
}

// ==========================================
// CANALES IPC DE COMUNICACIÓN CORE
// ==========================================
ipcMain.on('ping-servers', async (event, servidores) => {
    const resultados = {};

    const promesas = Object.keys(servidores).map(idPais => {
        return new Promise((resolve) => {
            const vlessUrl = servidores[idPais].vless;
            let host, port;

            try {
                const urlObj = new URL(vlessUrl);
                host = urlObj.hostname;
                port = parseInt(urlObj.port || '443', 10);
            } catch (e) {
                resultados[idPais] = { estado: "url_error", ping: -1 };
                resolve();
                return;
            }

            const startTime = Date.now();
            const socket = new net.Socket();
            socket.setTimeout(2000);

            socket.connect(port, host, () => {
                const ping = Date.now() - startTime;
                let estado = "optimal";
                if (ping >= 200 && ping <= 800) estado = "high_latency";
                if (ping > 800) estado = "overloaded";

                resultados[idPais] = { estado, ping };
                socket.destroy();
                resolve();
            });

            const errorSocket = (est) => {
                resultados[idPais] = { estado: est, ping: -1 };
                socket.destroy();
                resolve();
            };

            socket.on('error', () => errorSocket("down"));
            socket.on('timeout', () => errorSocket("timeout"));
        });
    });

    await Promise.all(promesas);
    event.reply('ping-results', resultados);
});

ipcMain.on('sincronizar-banderas', async (event, listaIso) => {
    try {
        const mapa = await flags.sincronizarBanderas(listaIso);
        event.reply('banderas-listas', mapa);
    } catch (e) {
        registrarErrorApp('sincronizar-banderas', e.message || String(e));
        event.reply('banderas-listas', {});
    }
});

ipcMain.on('activar-suscripcion', async (event, payload) => {
    const subUrl = (payload && payload.subUrl ? payload.subUrl : '').trim();
    if (!subUrl) return event.reply('suscripcion-error', t('sub-empty'));

    const resultado = await subscription.obtenerSuscripcion(subUrl);
    if (!resultado.ok) return event.reply('suscripcion-error', mapearErrorSub(resultado.error));

    const servidoresObj = {};
    for (const srv of resultado.servidores) {
        servidoresObj[srv.id] = {
            nombre: srv.nombre, nombreEN: srv.nombreEN, nombreRU: srv.nombreRU,
            vless: srv.vless, iso: srv.iso, emoji: srv.emoji, host: srv.host,
        };
    }

    configEnMemoria.subUrlCifrada = subscription.cifrarSubUrl(subUrl);
    configEnMemoria.servidores = servidoresObj;
    configEnMemoria.expiraSub = resultado.expira;
    configEnMemoria.traficoSub = resultado.trafico;
    configEnMemoria.tituloSub = resultado.titulo;

    store.set('userSettings', configEnMemoria);
    event.reply('suscripcion-exito', { servidores: servidoresObj, expira: resultado.expira, trafico: resultado.trafico, titulo: resultado.titulo });
});

ipcMain.on('refrescar-suscripcion', async (event) => {
    const subUrl = subscription.descifrarSubUrl(configEnMemoria.subUrlCifrada);
    if (!subUrl) return event.reply('suscripcion-error', t('sub-none'));

    const resultado = await subscription.obtenerSuscripcion(subUrl);
    if (!resultado.ok) {
        return event.reply('suscripcion-refrescada', { servidores: configEnMemoria.servidores, expira: configEnMemoria.expiraSub, trafico: configEnMemoria.traficoSub, titulo: configEnMemoria.tituloSub, offline: true });
    }

    const servidoresObj = {};
    for (const srv of resultado.servidores) {
        servidoresObj[srv.id] = {
            nombre: srv.nombre, nombreEN: srv.nombreEN, nombreRU: srv.nombreRU,
            vless: srv.vless, iso: srv.iso, emoji: srv.emoji, host: srv.host,
        };
    }

    configEnMemoria.servidores = servidoresObj;
    configEnMemoria.expiraSub = resultado.expira;
    configEnMemoria.traficoSub = resultado.trafico;
    configEnMemoria.tituloSub = resultado.titulo;

    store.set('userSettings', configEnMemoria);
    event.reply('suscripcion-refrescada', { servidores: servidoresObj, expira: resultado.expira, trafico: resultado.trafico, titulo: resultado.titulo, offline: false });
});

ipcMain.on('borrar-suscripcion', () => {
    configEnMemoria.subUrlCifrada = '';
    configEnMemoria.servidores = {};
    configEnMemoria.expiraSub = 0;
    configEnMemoria.traficoSub = { upload: 0, download: 0, total: 0 };
    configEnMemoria.tituloSub = 'Arrow VPN';
    configEnMemoria.ultimoServidor = '';
    store.set('userSettings', configEnMemoria);
});

function generarConfigSingbox(vlessUrl, nodeIP) {
    try {
        const url = new URL(vlessUrl);
        const params = new URLSearchParams(url.search);

        const hostOriginal = url.hostname;
        const sni = params.get("sni") || hostOriginal;
        const security = (params.get("security") || "").toLowerCase();
        const transportType = (params.get("type") || "tcp").toLowerCase();

        try { fs.writeFileSync(singboxLogPath, ''); } catch (err) {}
        puertoStealthLocal = Math.floor(Math.random() * (60000 - 10000 + 1)) + 10000;

        const proxyOutbound = {
            type: "vless",
            tag: "proxy",
            server: nodeIP,
            server_port: parseInt(url.port || "443", 10),
            uuid: url.username
        };

        const flow = params.get("flow");
        if (flow) proxyOutbound.flow = flow;

        if (security === "tls" || security === "reality") {
            proxyOutbound.tls = {
                enabled: true,
                server_name: sni,
                utls: { enabled: true, fingerprint: params.get("fp") || "chrome" }
            };

            const alpn = params.get("alpn");
            if (alpn) proxyOutbound.tls.alpn = alpn.split(",").map(v => v.trim()).filter(Boolean);

            if (security === "reality") {
                proxyOutbound.tls.reality = {
                    enabled: true,
                    public_key: params.get("pbk"),
                    short_id: params.get("sid") || ""
                };
            }
        }

        if (transportType === "ws") {
            proxyOutbound.transport = { type: "ws", path: params.get("path") || "/", headers: { Host: params.get("host") || sni } };
        } else if (transportType === "grpc") {
            proxyOutbound.transport = { type: "grpc" };
            const serviceName = params.get("serviceName") || params.get("service_name");
            if (serviceName) proxyOutbound.transport.service_name = serviceName;
        } else if (transportType === "httpupgrade") {
            proxyOutbound.transport = { type: "httpupgrade", host: params.get("host") || sni, path: params.get("path") || "/" };
        }

        const nodeCIDR = nodeIP.includes(":") ? `${nodeIP}/128` : `${nodeIP}/32`;

        const config = {
            log: { level: "info", output: singboxLogPath },
            dns: {
                reverse_mapping: true,
                servers: [
                    { type: "local", tag: "dns-local" },
                    { type: "https", tag: "dns-remote-v4", server: "1.1.1.1", server_port: 443, path: "/dns-query", detour: "proxy" },
                    { type: "https", tag: "dns-remote-v6", server: "2606:4700:4700::1111", server_port: 443, path: "/dns-query", detour: "proxy" }
                ],
                final: "dns-remote-v4"
            },
            inbounds: [],
            outbounds: [proxyOutbound, { type: "direct", tag: "direct" }],
            route: {
                auto_detect_interface: true,
                final: "proxy",
                default_domain_resolver: "dns-local",
                rules: [
                    { ip_cidr: ["127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "224.0.0.0/4", "255.255.255.255/32", "fc00::/7", "fe80::/10", "ff00::/8"], action: "route", outbound: "direct" },
                    { ip_cidr: [nodeCIDR], action: "route", outbound: "direct" },
                    { domain_suffix: ["ru", "su", "xn--p1ai"], action: "route", outbound: "direct" }
                ]
            }
        };

        if (configEnMemoria.connectionMode === "proxy") {
            config.inbounds = [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: puertoStealthLocal }];
        } else {
            config.inbounds = [{ type: "tun", tag: "tun-in", interface_name: "ArrowTUN", mtu: 1500, address: ["172.19.0.2/24", "fdfe:dcba:9876::2/64"], auto_route: true, strict_route: false, stack: "system" }];
        }

        fs.writeFileSync(configJsonPath, JSON.stringify(config, null, 4));
        return true;
    } catch (e) {
        registrarErrorApp('generar-config-singbox', e.stack || e.message || String(e));
        return false;
    }
}

ipcMain.on('conectar-vpn', async (event, payload) => {
    try {
        desconexionManual = false;
        const { vlessKey, serverId } = payload;
        configEnMemoria.ultimoServidor = serverId;
        store.set('userSettings', configEnMemoria);

        let vlessUrlObj;
        try { vlessUrlObj = new URL(vlessKey); } catch (e) { return event.reply('error-suscripcion', t('conn-bad-key')); }

        const nodeIP = await resolverIP(vlessUrlObj.hostname);
        if (!nodeIP) return event.reply('error-suscripcion', t('conn-server-unreachable'));

        if (configEnMemoria.expiraSub && configEnMemoria.expiraSub > 0) {
            if (Math.floor(Date.now() / 1000) >= configEnMemoria.expiraSub) return event.reply('error-suscripcion', t('sub-expired'));
        }

        if (!generarConfigSingbox(vlessKey, nodeIP)) return event.reply('error-suscripcion', t('conn-local-cfg'));

        limpiarProxySistema();
        if (configEnMemoria.connectionMode === 'vpn') {
            try { spawn('ipconfig', ['/flushdns'], { windowsHide: true }); } catch (e) {}
        }

        await iniciarSingbox(configJsonPath);

        if (configEnMemoria.connectionMode === 'proxy') {
            await esperarPuerto('127.0.0.1', puertoStealthLocal, 8000);
            activarProxySistema();
        } else {
            const interfazLista = await esperarInterfazTun('ArrowTUN', 30000);
            if (!interfazLista) throw new Error('El adaptador TUN no apareció a tiempo.');

            try {
                const psNetworkScriptPath = path.join(app.getPath('userData'), 'network_setup.ps1');
                const psNetworkCommands = `
                    netsh interface ip set address "ArrowTUN" static 172.19.0.2 255.255.255.0 172.19.0.1
                    netsh interface ip set dns "ArrowTUN" static 1.1.1.1 validate=no
                    netsh interface ipv6 set dnsservers "ArrowTUN" static 2606:4700:4700::1111 validate=no
                    netsh interface ipv4 set interface "ArrowTUN" metric=1
                    netsh interface ipv6 set interface "ArrowTUN" metric=1
                    Get-DnsClientNrptRule -ErrorAction SilentlyContinue | Where-Object {$_.Comment -eq 'ArrowVPN'} | Remove-DnsClientNrptRule -Force -ErrorAction SilentlyContinue
                    Add-DnsClientNrptRule -Namespace '.' -NameServers '1.1.1.1','2606:4700:4700::1111' -Comment 'ArrowVPN' -ErrorAction SilentlyContinue
                    Clear-DnsClientCache
                    ipconfig /flushdns
                `;
                fs.writeFileSync(psNetworkScriptPath, psNetworkCommands);
                spawn('powershell.exe', ['-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', psNetworkScriptPath], { windowsHide: true });
            } catch (e) {
                registrarErrorApp('network-setup-ps1', e.stack || e.message || String(e));
            }
        }

        isVpnConnected = true;
        iniciarMonitorSingbox();
        event.reply('vpn-conectada-exito');
    } catch (e) {
        isVpnConnected = false;
        await detenerSingbox();
        limpiarProxySistema();
        if (configEnMemoria.connectionMode === 'vpn') limpiarReglasFirewall();

        const detalle = [e.message, singboxStdErr.trim(), leerLogSingbox()].filter(Boolean).join('\n');
        registrarErrorApp('conectar-vpn', detalle);
        event.reply('error-suscripcion', resumirErrorParaUI(e.message, configEnMemoria.connectionMode));
    }
});

ipcMain.on('desconectar-vpn', async () => {
    desconexionManual = true;
    isVpnConnected = false;
    if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
    await detenerSingbox();
    limpiarProxySistema();
    if (configEnMemoria.connectionMode === 'vpn')  limpiarReglasFirewall();
});

ipcMain.on('cerrar-ventana', () => { mainWindow.close(); });
ipcMain.on('minimizar-ventana', () => { mainWindow.minimize(); });

app.on('will-quit', async () => {
    try { await detenerSingbox(); } catch (e) {}
    limpiarProxySistema();
    limpiarReglasFirewall();
});

// ==========================================
// HOOKS DE CIERRE DEFENSIVOS (anti-crash)
// ==========================================
app.on('before-quit', () => { try { limpiarProxySistemaAgresivo(); } catch (e) {} });

['SIGINT', 'SIGTERM', 'SIGHUP'].forEach(sig => {
    process.on(sig, () => { try { limpiarProxySistemaAgresivo(); } catch (e) {} process.exit(0); });
});

process.on('exit', () => {
    try {
        if (huboProxyActivoAnteriormente()) {
            try { execSync('reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f', { windowsHide: true, stdio: 'ignore', timeout: 2000 }); } catch (e) {}
            try { execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /f', { windowsHide: true, stdio: 'ignore', timeout: 2000 }); } catch (e) {}
            try { fs.unlinkSync(proxyFlagPath); } catch (e) {}
        }
    } catch (e) {}
});

process.on('uncaughtException', (err) => {
    try { registrarErrorApp('uncaught-exception', err.stack || err.message || String(err)); } catch (e) {}
    try { limpiarProxySistemaAgresivo(); } catch (e) {}
    process.exit(1);
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

ipcMain.on('get-settings', (event) => { event.reply('load-settings', configEnMemoria); });

ipcMain.on('save-settings', (event, data) => {
    const idiomaAnterior = configEnMemoria.idioma;
    configEnMemoria = { ...configEnMemoria, ...data };
    store.set('userSettings', configEnMemoria);

    if (data.idioma && data.idioma !== idiomaAnterior) aplicarMenuTray();

    if (!data.killSwitch) {
        try { spawn('netsh', ['advfirewall', 'firewall', 'delete', 'rule', 'name=Arrow_KS_Block'], { windowsHide: true }); } catch (e) {}
    }
});

ipcMain.on('get-app-version', (event) => { event.reply('app-version', app.getVersion()); });

ipcMain.on('copiar-suscripcion', (event) => {
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
    ota_downloaded = false;
    ota_downloadInProgress = false;
    if (mainWindow) {
        mainWindow.webContents.send('ota:available', {
            version: info.version,
            releaseDate: info.releaseDate,
            currentVersion: app.getVersion(),
        });
    }
});

autoUpdater.on('update-not-available', (info) => {
    console.log('[OTA] update-not-available. Cliente ya en la última versión.');
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
    ota_downloadInProgress = false;
    registrarErrorApp('auto-updater', err.stack || err.message || String(err));
    if (mainWindow) mainWindow.webContents.send('ota:error', { message: (err && err.message) || String(err) });
});

// -------- Handlers IPC del renderer → main --------
ipcMain.on('ota-check', async () => {
    console.log('[OTA] IPC ota-check');
    try {
        await autoUpdater.checkForUpdates();
    } catch (err) {
        console.log('[OTA] checkForUpdates fallo:', err.message);
        if (mainWindow) mainWindow.webContents.send('ota:error', { message: err.message });
    }
});

ipcMain.on('ota-download', async () => {
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
ipcMain.on('ota-install-restart', async () => {
    console.log('[OTA] IPC ota-install-restart');

    if (!ota_downloaded) {
        console.log('[OTA] update aún no descargado, ignoro');
        return;
    }

    try {
        await detenerSingbox();
    } catch (e) {}

    try {
        app.releaseSingleInstanceLock();
    } catch (e) {}

    console.log('[OTA] Ejecutando quitAndInstall nativo...');

    // Aquí está la solución clave para que no se bloquee en segundo plano
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
    asegurarIdiomaInicial();
    limpiarAccesosDirectosFantasma();

    try { await detenerSingbox(); } catch (e) { registrarErrorApp('startup-detener-singbox', e.stack || e.message || String(e)); }

    if (huboProxyActivoAnteriormente()) {
        registrarErrorApp('startup-recovery', 'Detectado flag de proxy activo: la sesión anterior crasheó. Limpiando registro.');
        try { limpiarProxySistemaAgresivo(); } catch (e) { registrarErrorApp('startup-recovery-fail', e.stack || e.message || String(e)); }
    } else {
        limpiarProxySistema();
    }

    limpiarReglasFirewall();
    createWindow();
    createTray();

    setTimeout(async () => {
        try {
            console.log('[OTA] chequeo inicial');
            await autoUpdater.checkForUpdates();
        } catch (err) {
            registrarErrorApp('startup-ota', err.stack || err.message || String(err));
        }
    }, 3000);

    setInterval(async () => {
        try { await autoUpdater.checkForUpdates(); } catch (err) { console.log('[OTA] chequeo periódico fallo:', err.message); }
    }, 60 * 60 * 1000);
});