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
            // --- NUEVOS ---
            'activar-suscripcion',
            'refrescar-suscripcion',
            'borrar-suscripcion',
            'sincronizar-banderas',
            'copiar-suscripcion'
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
            // --- NUEVOS ---
            'suscripcion-exito',
            'suscripcion-error',
            'suscripcion-refrescada',
            'banderas-listas',
            'suscripcion-copiada'
        ];
        if (canalesValidos.includes(canal)) {
            ipcRenderer.on(canal, (event, ...args) => funcion(...args));
        }
    }
});