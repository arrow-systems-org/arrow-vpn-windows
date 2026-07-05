const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apiVPN', {
    enviar: (canal, datos) => {
        const canalesValidos = [
            'conectar-vpn',
            'desconectar-vpn',
            'cerrar-ventana',
            'minimizar-ventana',
            'get-settings',
            'save-settings',
            'get-app-version',
            'ping-servers',
            // --- Suscripción ---
            'activar-suscripcion',
            'refrescar-suscripcion',
            'borrar-suscripcion',
            'sincronizar-banderas',
            'copiar-suscripcion',
            // --- OTA v3 (NUEVOS) ---
            'ota-check',
            'ota-download',
            'ota-install-restart'
        ];
        if (canalesValidos.includes(canal)) {
            ipcRenderer.send(canal, datos);
        }
    },
    recibir: (canal, funcion) => {
        const canalesValidos = [
            'load-settings',
            'vpn-conectada-exito',
            'error-suscripcion',
            'app-version',
            'update-status',
            'ping-results',
            'app-toast',
            // --- Suscripción ---
            'suscripcion-exito',
            'suscripcion-error',
            'suscripcion-refrescada',
            'banderas-listas',
            'suscripcion-copiada',
            // --- OTA v3 (NUEVOS) ---
            'ota:available',
            'ota:not-available',
            'ota:error',
            'ota:progress',
            'ota:downloaded'
        ];
        if (canalesValidos.includes(canal)) {
            ipcRenderer.on(canal, (event, ...args) => funcion(...args));
        }
    }
});
