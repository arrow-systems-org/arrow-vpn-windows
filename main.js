const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, session } = require('electron');
const Store = require('electron-store');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process'); // <-- Añadido execSync aquí
const os = require('os');
const net = require('net');

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
// SISTEMA ACTUALIZADOR OTA (PRODUCCIÓN)
// ==========================================
const { autoUpdater } = require('electron-updater');

// Evitar problemas de caché al descargar el latest.yml
autoUpdater.requestHeaders = { "Cache-Control": "no-cache" };

// Descarga silenciosa en segundo plano y autoinstalación al cerrar
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

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
    uuid: '',
    password: '',
    servidores: {},
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
        'msg-already-running': 'Arrow VPN ya está abierto.'
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
        'msg-already-running': 'Arrow VPN is already running.'
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
        'msg-already-running': 'Arrow VPN уже запущен.'
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

function getSettings() {
    const saved = store.get('userSettings') || {};

    return {
        uuid: saved.uuid || '',
        password: saved.password || '',
        servidores: saved.servidores || {},
        ultimoServidor: saved.ultimoServidor || '',
        tray: (saved.tray === false || saved.tray === 'false') ? false : true,
        autoConnect: (saved.autoConnect === true || saved.autoConnect === 'true'),
        killSwitch: (saved.killSwitch === true || saved.killSwitch === 'true'),
        connectionMode: saved.connectionMode || 'vpn',
        // null indica "aún no decidido"; se autodetecta en whenReady
        idioma: saved.idioma || null
    };
}

// ==========================================
// AUTODETECCIÓN DE IDIOMA EN PRIMERA APERTURA
// ==========================================
// Si no hay idioma guardado en el store, leemos el locale del SO
// vía app.getLocale() (que devuelve algo como 'ru-RU', 'es-ES', 'en-US').
// Mapeamos a uno de nuestros 3 idiomas soportados, con fallback a 'en'
// como default universal. La elección se persiste, así que solo aplica
// la primera vez que el usuario abre la app.
// ==========================================
const IDIOMAS_SOPORTADOS = ['es', 'en', 'ru'];

function detectarIdiomaSO() {
    try {
        const locale = (app.getLocale() || '').toLowerCase();
        const codigo = locale.split('-')[0]; // 'ru-RU' -> 'ru'

        if (IDIOMAS_SOPORTADOS.includes(codigo)) {
            return codigo;
        }
    } catch (e) {}

    return 'en'; // fallback universal
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
        return modo === 'proxy'
            ? t('err-proxy-local')
            : t('err-vpn-internal');
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

    return modo === 'proxy'
        ? t('err-proxy-start')
        : t('err-vpn-start');
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

function limpiarProxySistema() {
    try {
        const p = session.defaultSession.setProxy({
            proxyRules: 'direct://'
        });

        if (p && p.catch) {
            p.catch(() => {});
        }
    } catch (e) {}

    try {
        spawn('reg', [
            'add',
            'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
            '/v',
            'ProxyEnable',
            '/t',
            'REG_DWORD',
            '/d',
            '0',
            '/f'
        ], { windowsHide: true });
    } catch (e) {}

    refrescarProxyWindows();
}

function activarProxySistema() {
    try {
        const p = session.defaultSession.setProxy({
            proxyRules: `http=127.0.0.1:${puertoStealthLocal};https=127.0.0.1:${puertoStealthLocal}`
        });

        if (p && p.catch) {
            p.catch(() => {});
        }
    } catch (e) {}

    try {
        session.defaultSession.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    } catch (e) {}

    try {
        spawn('reg', [
            'add',
            'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
            '/v',
            'ProxyEnable',
            '/t',
            'REG_DWORD',
            '/d',
            '1',
            '/f'
        ], { windowsHide: true });

        spawn('reg', [
            'add',
            'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
            '/v',
            'ProxyServer',
            '/t',
            'REG_SZ',
            '/d',
            `127.0.0.1:${puertoStealthLocal}`,
            '/f'
        ], { windowsHide: true });
    } catch (e) {}

    refrescarProxyWindows();
}

function limpiarReglasFirewall() {
    try {
        spawn('netsh', [
            'advfirewall',
            'firewall',
            'delete',
            'rule',
            'name=Arrow_KS_Block'
        ], { windowsHide: true });
    } catch (e) {}

    try {
        const psCleanupScriptPath = path.join(app.getPath('userData'), 'cleanup_dns.ps1');

        const psCleanupCommands = `
            Get-DnsClientNrptRule -ErrorAction SilentlyContinue | Where-Object {$_.Comment -eq 'ArrowVPN'} | Remove-DnsClientNrptRule -Force -ErrorAction SilentlyContinue
            Clear-DnsClientCache
            ipconfig /flushdns
        `;

        fs.writeFileSync(psCleanupScriptPath, psCleanupCommands);

        spawn(
            'powershell.exe',
            ['-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', psCleanupScriptPath],
            { windowsHide: true }
        );
    } catch (e) {}
}

async function resolverIP(host) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
        return host;
    }

    if (host.includes(':')) {
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

        if (Array.isArray(ipv6) && ipv6.length > 0) {
            return ipv6[0];
        }

        if (Array.isArray(ipv4) && ipv4.length > 0) {
            return ipv4[0];
        }

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

// ==========================================
// NUEVA FUNCIÓN detenerSingbox (DOBLE TAP SÍNCRONO)
// ==========================================
function detenerSingbox() {
    return new Promise((resolve) => {
        // 1. Intentar el cierre elegante de Node.js
        try {
            if (proxyProcess && !proxyProcess.killed) {
                proxyProcess.kill();
            }
        } catch (e) {}

        proxyProcess = null;

        // 2. Failsafe FORZADO y SÍNCRONO con execSync
        try {
            execSync('taskkill /IM sing-box.exe /F /T', {
                windowsHide: true,
                stdio: 'ignore'
            });
        } catch (e) {}

        // 3. Pausa de gracia de 1.5s para liberar puertos
        setTimeout(resolve, 1500);
    });
}

function esperarPuerto(host, port, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();

        const intentar = () => {
            const socket = new net.Socket();
            let terminado = false;

            const cerrar = () => {
                try {
                    socket.destroy();
                } catch (e) {}
            };

            socket.setTimeout(1000);

            socket.connect(port, host, () => {
                if (terminado) return;

                terminado = true;
                cerrar();
                resolve(true);
            });

            socket.on('error', () => {
                if (terminado) return;

                terminado = true;
                cerrar();

                if (Date.now() - start >= timeoutMs) {
                    reject(new Error(`Timeout esperando puerto ${host}:${port}`));
                } else {
                    setTimeout(intentar, 250);
                }
            });

            socket.on('timeout', () => {
                if (terminado) return;

                terminado = true;
                cerrar();

                if (Date.now() - start >= timeoutMs) {
                    reject(new Error(`Timeout esperando puerto ${host}:${port}`));
                } else {
                    setTimeout(intentar, 250);
                }
            });
        };

        intentar();
    });
}

async function esperarInterfazTun(nombreInterfaz, timeoutMs = 30000) {
    const inicio = Date.now();

    while (Date.now() - inicio < timeoutMs) {
        try {
            const resultado = await ejecutarComandoCapturando('netsh', [
                'interface',
                'show',
                'interface'
            ]);

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
            const child = spawn(cmd, args, {
                windowsHide: true,
                ...options
            });

            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('error', (err) => {
                reject(err);
            });

            child.on('close', (code) => {
                resolve({
                    code,
                    stdout,
                    stderr
                });
            });
        } catch (err) {
            reject(err);
        }
    });
}

async function iniciarSingbox(configPath) {
    await detenerSingbox();
    limpiarBuffersSingbox();

    // Pausa táctica de 2 segundos para PCs viejas.
    await sleep(2000);

    try {
        if (fs.existsSync(singboxLogPath)) {
            fs.writeFileSync(singboxLogPath, '');
        }
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

        proxyProcess.stdout?.on('data', (data) => {
            const txt = data.toString();
            singboxStdOut += txt;
            console.log('[sing-box stdout]', txt);
        });

        proxyProcess.stderr?.on('data', (data) => {
            const txt = data.toString();
            singboxStdErr += txt;
            console.log('[sing-box stderr]', txt);
        });

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

            const detalle = [
                singboxStdErr.trim(),
                logTxt.trim()
            ].filter(Boolean).join('\n');

            reject(new Error(
                `sing-box terminó inmediatamente (code=${code}, signal=${signal || 'null'})` +
                (detalle ? `\n${detalle}` : '')
            ));
        });

        setTimeout(() => {
            if (resuelto) return;

            resuelto = true;
            resolve(true);
        }, 1200);
    });
}

function iniciarMonitorSingbox() {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
    }

    monitorInterval = setInterval(() => {
        if (!isVpnConnected || desconexionManual) return;

        try {
            if (!proxyProcess || proxyProcess.killed || proxyProcess.exitCode !== null) {
                isVpnConnected = false;

                if (monitorInterval) {
                    clearInterval(monitorInterval);
                    monitorInterval = null;
                }

                const detalle = leerLogSingbox() || singboxStdErr || 'El motor VPN se detuvo.';

                registrarErrorApp('monitor-singbox', detalle);

                if (mainWindow && !mainWindow.isDestroyed()) {
                    const msgBase = resumirErrorParaUI(
                        'sing-box terminó inmediatamente',
                        configEnMemoria.connectionMode
                    );

                    mainWindow.webContents.send(
                        'error-suscripcion',
                        configEnMemoria.killSwitch
                            ? `${t('conn-lost-blocked')} ${msgBase}`
                            : `${t('conn-lost')} ${msgBase}`
                    );
                }
            }
        } catch (e) {
            registrarErrorApp('monitor-singbox-exception', e.message || String(e));
        }
    }, 3000);
}

// ==========================================
// MOTOR DE PING LOCAL TCP
// Estados son CÓDIGOS estables (no texto traducible).
// El renderer mapea estos códigos a texto según idioma.
// Códigos: optimal | high_latency | overloaded | down | timeout | url_error
// ==========================================
ipcMain.on('ping-servers', async (event, servidores) => {
    const resultados = {};

    const promesas = Object.keys(servidores).map(idPais => {
        return new Promise((resolve) => {
            const vlessUrl = servidores[idPais].vless;

            let host;
            let port;

            try {
                const urlObj = new URL(vlessUrl);
                host = urlObj.hostname;
                port = parseInt(urlObj.port || '443', 10);
            } catch (e) {
                resultados[idPais] = {
                    estado: "url_error",
                    ping: -1
                };

                resolve();
                return;
            }

            const startTime = Date.now();
            const socket = new net.Socket();

            socket.setTimeout(2000);

            socket.connect(port, host, () => {
                const ping = Date.now() - startTime;

                let estado = "optimal";

                if (ping >= 200 && ping <= 800) {
                    estado = "high_latency";
                }

                if (ping > 800) {
                    estado = "overloaded";
                }

                resultados[idPais] = {
                    estado,
                    ping
                };

                socket.destroy();
                resolve();
            });

            socket.on('error', () => {
                resultados[idPais] = {
                    estado: "down",
                    ping: -1
                };

                socket.destroy();
                resolve();
            });

            socket.on('timeout', () => {
                resultados[idPais] = {
                    estado: "timeout",
                    ping: -1
                };

                socket.destroy();
                resolve();
            });
        });
    });

    await Promise.all(promesas);

    event.reply('ping-results', resultados);
});

ipcMain.on('login-request', async (event, creds) => {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(`${API_BASE_URL}/api/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uuid: creds.uuid,
                password: creds.password
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        const data = await response.json();

        if (response.ok && data.valido) {
            configEnMemoria.uuid = creds.uuid;
            configEnMemoria.password = creds.password;
            configEnMemoria.servidores = data.servidores;

            store.set('userSettings', configEnMemoria);

            event.reply('login-success', configEnMemoria);
        } else {
            event.reply('login-error', data.msg || t('login-bad-creds'));
        }
    } catch (e) {
        if (
            configEnMemoria.uuid &&
            creds.uuid === configEnMemoria.uuid &&
            creds.password === configEnMemoria.password
        ) {
            console.log("Activando Login en Caché por falta de red...");
            event.reply('login-success', configEnMemoria);
        } else {
            event.reply('login-error', t('login-master-err'));
        }
    }
});

ipcMain.on('logout-request', () => {
    configEnMemoria.uuid = '';
    configEnMemoria.password = '';
    configEnMemoria.servidores = {};

    store.set('userSettings', configEnMemoria);
});

async function verificarSuscripcionReal(uuid) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const response = await fetch(`${API_BASE_URL}/validar/${uuid}`, {
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            return {
                valido: false,
                msg: t('sub-inactive')
            };
        }

        return await response.json();
    } catch (e) {
        return {
            valido: false,
            msg: t('sub-timeout')
        };
    }
}

function generarConfigSingbox(vlessUrl, nodeIP) {
    try {
        const url = new URL(vlessUrl);
        const params = new URLSearchParams(url.search);

        const hostOriginal = url.hostname;
        const sni = params.get("sni") || hostOriginal;
        const security = (params.get("security") || "").toLowerCase();
        const transportType = (params.get("type") || "tcp").toLowerCase();

        try {
            fs.writeFileSync(singboxLogPath, '');
        } catch (err) {}

        puertoStealthLocal = Math.floor(Math.random() * (60000 - 10000 + 1)) + 10000;

        const proxyOutbound = {
            type: "vless",
            tag: "proxy",
            server: nodeIP,
            server_port: parseInt(url.port || "443", 10),
            uuid: url.username
        };

        const flow = params.get("flow");

        if (flow) {
            proxyOutbound.flow = flow;
        }

        if (security === "tls" || security === "reality") {
            proxyOutbound.tls = {
                enabled: true,
                server_name: sni,
                utls: {
                    enabled: true,
                    fingerprint: params.get("fp") || "chrome"
                }
            };

            const alpn = params.get("alpn");

            if (alpn) {
                proxyOutbound.tls.alpn = alpn
                    .split(",")
                    .map(v => v.trim())
                    .filter(Boolean);
            }

            if (security === "reality") {
                proxyOutbound.tls.reality = {
                    enabled: true,
                    public_key: params.get("pbk"),
                    short_id: params.get("sid") || ""
                };
            }
        }

        if (transportType === "ws") {
            proxyOutbound.transport = {
                type: "ws",
                path: params.get("path") || "/",
                headers: {
                    Host: params.get("host") || sni
                }
            };
        } else if (transportType === "grpc") {
            proxyOutbound.transport = {
                type: "grpc"
            };

            const serviceName = params.get("serviceName") || params.get("service_name");

            if (serviceName) {
                proxyOutbound.transport.service_name = serviceName;
            }
        } else if (transportType === "httpupgrade") {
            proxyOutbound.transport = {
                type: "httpupgrade",
                host: params.get("host") || sni,
                path: params.get("path") || "/"
            };
        }

        const nodeCIDR = nodeIP.includes(":")
            ? `${nodeIP}/128`
            : `${nodeIP}/32`;

        const config = {
            log: {
                level: "info",
                output: singboxLogPath
            },
            dns: {
                reverse_mapping: true,
                servers: [
                    {
                        type: "local",
                        tag: "dns-local"
                    },
                    {
                        type: "https",
                        tag: "dns-remote-v4",
                        server: "1.1.1.1",
                        server_port: 443,
                        path: "/dns-query",
                        detour: "proxy"
                    },
                    {
                        type: "https",
                        tag: "dns-remote-v6",
                        server: "2606:4700:4700::1111",
                        server_port: 443,
                        path: "/dns-query",
                        detour: "proxy"
                    }
                ],
                final: "dns-remote-v4"
            },
            inbounds: [],
            outbounds: [
                proxyOutbound,
                {
                    type: "direct",
                    tag: "direct"
                }
            ],
            route: {
                auto_detect_interface: true,
                final: "proxy",
                default_domain_resolver: "dns-local",
                rules: [
                    {
                        ip_cidr: [
                            "127.0.0.0/8",
                            "::1/128",
                            "10.0.0.0/8",
                            "172.16.0.0/12",
                            "192.168.0.0/16",
                            "169.254.0.0/16",
                            "224.0.0.0/4",
                            "255.255.255.255/32",
                            "fc00::/7",
                            "fe80::/10",
                            "ff00::/8"
                        ],
                        action: "route",
                        outbound: "direct"
                    },
                    {
                        ip_cidr: [nodeCIDR],
                        action: "route",
                        outbound: "direct"
                    },
                    {
                        domain_suffix: ["ru", "su", "xn--p1ai"],
                        action: "route",
                        outbound: "direct"
                    }
                ]
            }
        };

        if (configEnMemoria.connectionMode === "proxy") {
            config.inbounds = [
                {
                    type: "mixed",
                    tag: "mixed-in",
                    listen: "127.0.0.1",
                    listen_port: puertoStealthLocal
                }
            ];
        } else {
            config.inbounds = [
                {
                    type: "tun",
                    tag: "tun-in",
                    interface_name: "ArrowTUN",
                    mtu: 1500,
                    address: [
                        "172.19.0.2/24",
                        "fdfe:dcba:9876::2/64"
                    ],
                    auto_route: true,
                    strict_route: false,
                    stack: "system"
                }
            ];
        }

        fs.writeFileSync(configJsonPath, JSON.stringify(config, null, 4));

        return true;
    } catch (e) {
        console.log("Error generando config sing-box:", e.message);

        registrarErrorApp(
            'generar-config-singbox',
            e.stack || e.message || String(e)
        );

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

        try {
            vlessUrlObj = new URL(vlessKey);
        } catch (e) {
            return event.reply('error-suscripcion', t('conn-bad-key'));
        }

        const nodeIP = await resolverIP(vlessUrlObj.hostname);

        if (!nodeIP) {
            return event.reply('error-suscripcion', t('conn-server-unreachable'));
        }

        const status = await verificarSuscripcionReal(configEnMemoria.uuid);

        if (!status.valido) {
            return event.reply('error-suscripcion', status.msg || t('conn-sub-invalid'));
        }

        if (!generarConfigSingbox(vlessKey, nodeIP)) {
            return event.reply('error-suscripcion', t('conn-local-cfg'));
        }

        // Limpieza previa por si quedó algo de una sesión anterior
        limpiarProxySistema();

        if (configEnMemoria.connectionMode === 'vpn') {
            try {
                spawn('ipconfig', ['/flushdns'], { windowsHide: true });
            } catch (e) {}
        }

        await iniciarSingbox(configJsonPath);

        if (configEnMemoria.connectionMode === 'proxy') {
            await esperarPuerto('127.0.0.1', puertoStealthLocal, 8000);
            activarProxySistema();
        } else {
            const interfazLista = await esperarInterfazTun('ArrowTUN', 30000);

            if (!interfazLista) {
                throw new Error('El adaptador TUN no apareció a tiempo.');
            }

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

                spawn(
                    'powershell.exe',
                    ['-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', psNetworkScriptPath],
                    { windowsHide: true }
                );
            } catch (e) {
                registrarErrorApp(
                    'network-setup-ps1',
                    e.stack || e.message || String(e)
                );
            }
        }

        isVpnConnected = true;

        iniciarMonitorSingbox();

        event.reply('vpn-conectada-exito');
    } catch (e) {
        console.log('Error al iniciar VPN:', e.message);

        isVpnConnected = false;

        await detenerSingbox();

        limpiarProxySistema();

        if (configEnMemoria.connectionMode === 'vpn') {
            limpiarReglasFirewall();
        }

        const detalle = [
            e.message,
            singboxStdErr.trim(),
            leerLogSingbox()
        ].filter(Boolean).join('\n');

        registrarErrorApp('conectar-vpn', detalle);

        event.reply(
            'error-suscripcion',
            resumirErrorParaUI(e.message, configEnMemoria.connectionMode)
        );
    }
});

ipcMain.on('desconectar-vpn', async () => {
    desconexionManual = true;
    isVpnConnected = false;

    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
    }

    await detenerSingbox();

    limpiarProxySistema();

    if (configEnMemoria.connectionMode === 'vpn') {
        limpiarReglasFirewall();
    }
});

ipcMain.on('cerrar-ventana', () => {
    mainWindow.close();
});

app.on('will-quit', async () => {
    try {
        await detenerSingbox();
    } catch (e) {}

    limpiarProxySistema();
    limpiarReglasFirewall();
});

// ==========================================
// SEGUNDA INSTANCIA: si el usuario intenta abrir
// la app de nuevo, traemos al frente la ventana
// existente y le mostramos un aviso.
// ==========================================
app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }

    if (!mainWindow.isVisible()) {
        mainWindow.show();
    }

    mainWindow.focus();

    try {
        mainWindow.webContents.send('app-toast', t('msg-already-running'));
    } catch (e) {}
});

ipcMain.on('get-settings', (event) => {
    event.reply('load-settings', configEnMemoria);
});

ipcMain.on('save-settings', (event, data) => {
    const idiomaAnterior = configEnMemoria.idioma;

    configEnMemoria = {
        ...configEnMemoria,
        ...data
    };

    store.set('userSettings', configEnMemoria);

    // Si el idioma cambió, reconstruimos el menú del tray
    if (data.idioma && data.idioma !== idiomaAnterior) {
        aplicarMenuTray();
    }

    if (!data.killSwitch) {
        try {
            spawn('netsh', [
                'advfirewall',
                'firewall',
                'delete',
                'rule',
                'name=Arrow_KS_Block'
            ], { windowsHide: true });
        } catch (e) {}
    }
});

ipcMain.on('get-app-version', (event) => {
    event.reply('app-version', app.getVersion());
});

ipcMain.on('minimizar-ventana', () => {
    mainWindow.minimize();
});

function createTray() {
    tray = new Tray(
        nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({
            width: 24
        })
    );

    aplicarMenuTray();

    tray.on('double-click', () => mainWindow.show());
}

function aplicarMenuTray() {
    if (!tray || tray.isDestroyed()) return;

    tray.setContextMenu(Menu.buildFromTemplate([
        {
            label: t('tray-show'),
            click: () => mainWindow.show()
        },
        {
            type: 'separator'
        },
        {
            label: t('tray-quit'),
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]));
}

// ==========================================
// RECEPTORES DEL SISTEMA OTA
// ==========================================
autoUpdater.on('update-available', () => {
    if (mainWindow) {
        mainWindow.webContents.send('update-status', t('ota-downloading'));
    }
});

autoUpdater.on('update-downloaded', () => {
    if (mainWindow) {
        mainWindow.webContents.send('update-status', t('ota-ready'));
    }

    const dialogOpts = {
        type: 'info',
        buttons: [t('ota-btn-install'), t('ota-btn-later')],
        title: t('ota-title'),
        message: t('ota-message'),
        detail: t('ota-detail'),
        defaultId: 0,
        cancelId: 1
    };

    dialog.showMessageBox(mainWindow, dialogOpts).then(async (returnValue) => {
        if (returnValue.response === 0) {
            try {
                await detenerSingbox();
            } catch (e) {}

            // Liberamos el candado de instancia única antes de que el
            // updater lance la nueva versión. Si no lo hiciéramos,
            // podría haber una carrera donde el nuevo proceso intenta
            // arrancar mientras el SO aún tiene el mutex del viejo y
            // se autoexpulsa pensando que ya hay una instancia abierta.
            try {
                app.releaseSingleInstanceLock();
            } catch (e) {}

            autoUpdater.quitAndInstall(false, true);
        }
    });
});

autoUpdater.on('error', (err) => {
    console.log('Error silencioso en OTA:', err.message);

    registrarErrorApp(
        'auto-updater',
        err.stack || err.message || String(err)
    );
});

function limpiarAccesosDirectosFantasma() {
    try {
        const userStartMenu = path.join(
            process.env.APPDATA || '',
            'Microsoft',
            'Windows',
            'Start Menu',
            'Programs',
            'Arrow VPN.lnk'
        );

        const userMenuFolder = path.join(
            process.env.APPDATA || '',
            'Microsoft',
            'Windows',
            'Start Menu',
            'Programs',
            'Arrow VPN'
        );

        if (fs.existsSync(userStartMenu)) {
            fs.unlinkSync(userStartMenu);
        }

        if (fs.existsSync(userMenuFolder)) {
            fs.rmSync(userMenuFolder, {
                recursive: true,
                force: true
            });
        }
    } catch (e) {
        console.log("Error limpiando accesos directos:", e.message);

        registrarErrorApp(
            'limpiar-accesos-directos',
            e.stack || e.message || String(e)
        );
    }
}

app.whenReady().then(async () => {
    // Autodetectar idioma del SO si es la primera apertura.
    // Debe ejecutarse aquí porque app.getLocale() requiere que
    // el módulo 'app' esté listo. Se ejecuta ANTES de createTray()
    // porque el menú del tray usa t() y necesita el idioma resuelto.
    asegurarIdiomaInicial();

    limpiarAccesosDirectosFantasma();

    try {
        await detenerSingbox();
    } catch (e) {
        registrarErrorApp(
            'startup-detener-singbox',
            e.stack || e.message || String(e)
        );
    }

    limpiarProxySistema();
    limpiarReglasFirewall();

    createWindow();
    createTray();

    setTimeout(async () => {
        try {
            await autoUpdater.checkForUpdatesAndNotify();
        } catch (err) {
            console.log('Fallo al iniciar el servicio OTA:', err.message);

            registrarErrorApp(
                'startup-ota',
                err.stack || err.message || String(err)
            );
        }
    }, 3000);
});