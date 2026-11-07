# Arrow VPN 3.1.5 — Enrutamiento inteligente (RU Direct)

**Proyecto base:** Arrow VPN 3.1.4 (Electron + sing-box-lx).  
**Nuevo modo:** RU Direct opt-in desde Ajustes, guardado en `electron-store`.  
**Motor:** se mantiene `bin/sing-box.exe` **sin sustituirlo**. El autor actualizará sing-box-lx por su cuenta.

## Cómo funciona

Al activar **Ajustes → Enrutamiento inteligente** y volver a conectar:

- Las direcciones de redes privadas ya siguen DIRECT como en 3.1.4.
- `.ru`, `.su`, `.рф` (Punycode `xn--p1ai`) y los dominios del perfil Happ recibido (VK, Yandex, Ozon, OKKO, Boosty, etc.) usan `direct`.
- Los dominios del rule-set `geosite-category-ru.srs`, cuando está disponible, usan `direct`.
- Las IP de `geoip-ru.srs`, cuando está disponible, usan `direct`.
- El tráfico restante utiliza el outbound `proxy` de Arrow VPN.
- Las consultas DNS de dominios rusos explícitos o incluidos en el rule-set van al DNS local; las demás mantienen el DoH configurado en Arrow VPN. El TUN intercepta las consultas DNS para poder asociar dominios y rutas.

El motor emplea **rule-sets `.srs`** (formato moderno), no los campos eliminados `geosite` y `geoip` de versiones antiguas de sing-box. El perfil de Happ sirve como lista de referencia, pero la app **no depende de una suscripción Happ ni interpreta `happ://` automáticamente**.

### Dónde están las listas en Windows

`%APPDATA%/arrow-vpn/rule-sets/` (ruta real: `app.getPath('userData')/rule-sets`)

Archivos:

- `geosite-category-ru.srs`
- `geoip-ru.srs`

Se comprueban y actualizan en segundo plano al **abrir la app**. La descarga **no bloquea** la interfaz ni la conexión VPN; en la primera ejecución, si aún no terminó, aplicará las excepciones explícitas, y los nuevos rule-sets entrarán en vigor en la siguiente conexión. Las copias anteriores se mantienen si todas las fuentes fallan.

## Orden de mirrors y failover

La aplicación intenta los archivos mediante HTTPS desde estas ubicaciones **en este orden**, tal como pediste (GitHub primero y los espejos propios después):

1. **GitHub oficial SagerNet**: `https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-category-ru.srs` y `https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-ru.srs`.
2. `https://updates.arrow-x.org/rulesets/ru/`
3. `https://updates.ru.arrow-x.com/rulesets/ru/`
4. `https://arrow-updates.xyz/rulesets/ru/`

**IMPORTANTE:** que los mirrors sirvan instaladores en `/windows/stable` **no significa que ya existan estos nuevos archivos**. Es necesario publicarlos por primera vez.

### Preparar los espejos

En los hosts de actualización:

```bash
sudo install -m 755 mirror-setup/update-ru-rule-sets.sh /usr/local/sbin/arrow-update-ru-rule-sets
sudo /usr/local/sbin/arrow-update-ru-rule-sets /srv/arrow-updates/rulesets/ru
```

En cada `server {}` Nginx de los tres dominios, insertar el contenido de `mirror-setup/nginx-rulesets-example.conf` (adapta la ruta si tu root es diferente). Validar y recargar:

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -fI https://updates.arrow-x.org/rulesets/ru/geoip-ru.srs
curl -fI https://updates.arrow-x.org/rulesets/ru/geosite-category-ru.srs
```

Programar sincronización diaria si quieres (copia `.service` y `.timer` a `/etc/systemd/system/`):

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now arrow-ru-rules.timer
sudo systemctl list-timers arrow-ru-rules.timer
```

El script actualiza ambos archivos desde `SagerNet/sing-geosite` y `SagerNet/sing-geoip`, valida cabecera SRS y compresión zlib, y publica archivos atómicamente. Para publicar en los otros espejos, ejecútalo allí también o replica el directorio generado.

## Integración / archivos modificados

- `main.js`: activa reglas cuando se genera el JSON, guarda el toggle, lanza sincronización de listas al arrancar.
- `smart-routing.js`: traducción de Happ a reglas sing-box `direct`, `dns-local`, `rule_set` y `hijack-dns`.
- `rule-set-updater.js`: HTTP TLS, límite de tamaño, espejos con failover, validación y último archivo válido.
- `renderer.js`, `index.html`, `style.css`: interruptor y texto en español, inglés y ruso.
- `package.json` y `package-lock.json`: nueva versión y empaquetado de módulos.
- `tests/smart-routing.test.js`: pruebas unitarias sin Internet.

## Actualizar sing-box-lx

Reemplaza por tu cuenta el binario de `bin/sing-box.exe` con una compilación **Windows compatible sing-box-lx**. Conserva, si tu compilación lo necesita, el `libcronet.dll` de la **misma versión** y `wintun.dll` según tus builds. Comprueba:

```powershell
.\bin\sing-box.exe version
.\bin\sing-box.exe check -c ruta\a\config.json
```

La app comprueba en tiempo de ejecución que el motor sea sing-box-lx `1.14.1-lx.4` o superior. En noviembre de 2026 el upstream `Leadaxe/sing-box-lx` ya ofrece ramas más recientes (por ejemplo, `1.14.4-lx.32`); instala la última build estable adecuada para Windows y comprueba su versión antes de distribuirla. No se ha incluido ningún motor nuevo en este parche.

## Notas y límites

- **Solo se aplica tras desconectar y reconectar:** no cambia en caliente un TUN activo; el interruptor queda bloqueado mientras hay conexión.
- **Sin rule-sets en primera ejecución:** se aplican las excepciones de dominios explícitos; GeoIP y la cobertura adicional de geosite se activan cuando haya archivos válidos.
- **No equivale a una prueba de Windows real:** `npm test` valida el código, pero debes comprobar split tunnel, DNS y Kill Switch en un Windows de prueba antes de lanzar la actualización a todos tus usuarios.
- **Modo Proxy:** las reglas aplican únicamente al tráfico que el programa cliente manda al proxy local. No convierten todo Windows en TUN.
- **Kill Switch:** el tráfico DIRECT gestionado por el proceso sing-box queda bajo las reglas de firewall de Arrow. Evalúa si quieres usar RU Direct y Kill Switch simultáneamente.
- **Servicios rusos con IP compartidas o DoH propia:** un dominio puede no identificarse siempre. El DNS/TUN no puede garantizar el 100 % de los destinos cuando una aplicación usa IPs directas, TLS cifrado no identificable o resoluciones propias.
- La categoría `category-ru` de SagerNet puede no coincidir al 100 % con la categoría Happ de tus listas; los dominios explícitos sí fueron transcritos.
- **Fuente y seguridad:** se acepta el `.srs` por HTTPS y se comprueba su estructura básica, pero eso no es una firma digital del productor. Para seguridad reforzada, añade más adelante una lista de hashes firmada por Arrow.
- **La app solicita las actualizaciones al iniciarse**, también si el interruptor está apagado. Solo aplica las reglas al activar Enrutamiento inteligente; los archivos descargados no cambian automáticamente una conexión activa.
- **Primera ejecución sin listas**: el cliente funciona con coincidencias de dominios explícitos. No promete cobertura de IPs RU hasta disponer de `geoip-ru.srs`.
- Se respetan claves de nodos y suscripciones, DNS general, modo conexión, selección de servidor y actualizaciones OTA existentes.

## Pruebas antes de publicar

```bash
npm run check
npm test
```

En Windows, compila con `npm install && npm run build`, activa la opción, prueba `vk.com` y `yandex.ru` con tu IP de proveedor, comprueba un dominio extranjero con IP VPN, DNS con sitios RU, funcionamiento de IPv6 y reconexión con Kill Switch activado. Repite en modo Proxy solo con aplicaciones que utilicen el proxy local.

## Fuentes

- https://sing-box.sagernet.org/configuration/rule-set/
- https://sing-box.sagernet.org/configuration/route/rule/
- https://sing-box.sagernet.org/migration/
- https://github.com/SagerNet/sing-geosite
- https://github.com/SagerNet/sing-geoip
- https://github.com/Leadaxe/sing-box-lx/releases
