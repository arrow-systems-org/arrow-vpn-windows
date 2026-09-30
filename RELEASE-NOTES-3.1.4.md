# Arrow VPN 3.1.4

## Connection-state change

`CONNECTED` now means the sing-box engine and the selected local transport are ready:

- TUN mode: ArrowTUN exists and Windows routing/configuration was applied.
- Proxy mode: the local proxy port is ready and the system proxy was enabled.

External HTTP health probes no longer gate or tear down an otherwise running tunnel.

## Background Internet verification

About 1.5 seconds after CONNECTED, Arrow runs the following external probes in parallel:

- https://detectportal.firefox.com/success.txt
- https://www.msftconnecttest.com/connecttest.txt
- https://captive.apple.com/hotspot-detect.html

One HTTP 2xx/3xx response marks Internet access as VERIFIED. If all probes fail, the connection remains active; the DEGRADED result is written only to internal logs and is not shown to the user.

No Arrow-owned domain is used for these health checks.

## Retry behavior

Up to five retries remain for genuine retryable startup failures such as engine/TUN startup, explicit REALITY/TLS handshake errors, timeouts, resets, DNS resolution failures, or unreachable nodes. A background health-check failure is not retryable and does not cause cleanup.

## UI

- Keeps the compact toast/error-card behavior introduced in the previous patch.
- Successful background verification may still be shown; failed verification is log-only and silent in the UI.
- The connect button can still cancel an in-progress retry sequence.

## OTA download failover

Manual update downloads now use the same mirror failover path as automatic OTA operations. If the active mirror cannot serve the installer, Arrow tries the remaining configured mirrors and validates that each fallback advertises the expected version before downloading.

## Validation

- `npm run check`: passed
- `npm test`: 42/42 passed

## IPv6 automático por nodo

- Nuevo switch **IPv6 automático** (desactivado por defecto).
- Al conectar, Arrow comprueba de forma no destructiva si el nodo puede abrir una conexión IPv6 real.
- Si el nodo soporta IPv6, el TUN se levanta en dual-stack IPv4+IPv6.
- Si el nodo no soporta IPv6 o el probe falla, la conexión continúa automáticamente en IPv4 sin mostrar error al usuario.
- El probe de capacidad exige ahora un handshake TLS real por IPv6; aceptar un SOCKS/VLESS CONNECT ya no basta para marcar un nodo como dual-stack.
- Al caer a IPv4 se limpian direcciones/rutas IPv6 residuales del adaptador ArrowTUN.
- El resultado se cachea por nodo durante 10 minutos para evitar retrasos repetidos.

### UX hardening
- Automatic IPv6 can only be changed while fully disconnected; the main process also rejects hot changes during an active connection.
- The frameless title bar now keeps a stable native drag region after window resizing.
- The window can grow, but cannot be resized below its base 380×600 layout.
