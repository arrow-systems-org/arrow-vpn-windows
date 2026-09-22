const { contextBridge, ipcRenderer } = require('electron');

const SEND_CHANNELS = new Set([
  'conectar-vpn',
  'desconectar-vpn',
  'cerrar-ventana',
  'minimizar-ventana',
  'get-settings',
  'save-settings',
  'get-app-version',
  'ping-servers',
  'activar-suscripcion',
  'refrescar-suscripcion',
  'borrar-suscripcion',
  'sincronizar-banderas',
  'copiar-suscripcion',
  'copiar-nodo',
  'ota-check',
  'ota-download',
  'ota-install-restart'
]);

const RECEIVE_CHANNELS = new Set([
  'load-settings',
  'vpn-conectada-exito',
  'vpn-desconectada-exito',
  'error-suscripcion',
  'app-version',
  'update-status',
  'ping-results',
  'app-toast',
  'suscripcion-exito',
  'suscripcion-error',
  'suscripcion-refrescada',
  'banderas-listas',
  'suscripcion-copiada',
  'nodo-copiado',
  'ota:available',
  'ota:not-available',
  'ota:error',
  'ota:progress',
  'ota:downloaded'
]);

function send(channel, data) {
  if (!SEND_CHANNELS.has(channel)) throw new Error(`IPC channel not allowed: ${channel}`);
  ipcRenderer.send(channel, data);
}

function on(channel, callback) {
  if (!RECEIVE_CHANNELS.has(channel)) throw new Error(`IPC channel not allowed: ${channel}`);
  if (typeof callback !== 'function') throw new TypeError('callback must be a function');

  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('arrow', Object.freeze({
  send,
  on,
  clipboard: Object.freeze({
    writeText: (text) => ipcRenderer.invoke('clipboard-write', String(text ?? ''))
  })
}));
