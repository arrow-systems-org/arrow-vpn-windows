# Arrow VPN (Windows)

[![Version](https://img.shields.io/github/v/release/arrow-systems-org/arrow-vpn-windows?label=version&color=blue)](https://github.com/arrow-systems-org/arrow-vpn-windows/releases/latest)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
![Status](https://img.shields.io/badge/status-stable-success)
[![Engine](https://img.shields.io/badge/engine-sing--box--lx-purple)](https://github.com/Leadaxe/sing-box-lx)

## Arrow VPN

Arrow VPN is a privacy-focused Windows VPN client. Arrow VPN subscriptions are first-class, but the client is intentionally **not locked to Arrow as a provider**: compatible third-party subscriptions and individual share links can be imported without an Arrow account or a central Arrow authentication service.

The app parses subscription data locally, keeps node credentials in the Electron main process, and stores subscription/node secrets encrypted at rest with Windows DPAPI through Electron `safeStorage`.

## Features

- **Provider-agnostic subscriptions**: Arrow VPN or compatible external providers.
- **Single-node import** for supported share links.
- Supported node schemes: **VLESS, Trojan, VMess, Shadowsocks, Hysteria2/Hy2 and TUIC**.
- **VLESS + REALITY + XHTTP** support through sing-box-lx.
- VLESS `encryption` passthrough and sing-box-lx REALITY `key_share`, `fragment` and `record_fragment` support.
- System-wide **TUN** mode and local **Proxy** mode.
- **Kill Switch** with restoration of the user's previous Windows firewall policy.
- IPv4 + IPv6 TUN support.
- `strict_route` enabled in TUN mode to reduce DNS/routing leaks on Windows.
- Real connection health check before the UI reports a successful connection.
- Automatic recovery when the core exits unexpectedly.
- Local server reachability radar without exposing node credentials to the renderer.
- English, Spanish and Russian UI.
- Subscription URL and node credentials encrypted at rest.
- HTTPS-only remote subscriptions; HTTPS redirects are not allowed to downgrade to HTTP.
- Subscription response size cap to protect the Electron main process.

### Subscription compatibility

Arrow currently accepts:

- HTTPS subscription URLs whose response is a plaintext list of supported share links.
- Base64-encoded lists of supported share links.
- A single supported share link pasted directly into the activation field.

Arrow does **not** currently parse arbitrary Clash YAML or arbitrary sing-box JSON subscription documents. Providers that offer a URI/base64 subscription format should work without Arrow-specific authentication.

## Engine requirement

Arrow 3.1.x requires **sing-box-lx 1.14.1-lx.4 or newer**. The app checks the core version and runs `sing-box check` on every generated configuration before starting it.

This source package intentionally does not need to bundle a core. Put the Windows build in `bin/` as described in [`bin/README-SING-BOX-LX.txt`](./bin/README-SING-BOX-LX.txt).

The lx.4 release is particularly relevant to REALITY compatibility with Xray 26.9.8/26.9.9 because it supports the hybrid `X25519MLKEM768` key share and applies `fragment` / `record_fragment` to REALITY.

## Privacy model

Arrow Client does not require a central Arrow login. A subscription is treated as a local source of node definitions. External subscription URLs are requested directly by the client; they are not sent to an Arrow conversion/authentication endpoint.

Secrets are kept out of the renderer process. The renderer receives sanitized server metadata only. The encrypted subscription URL and encrypted node map are stored through Windows DPAPI. Runtime sing-box logging defaults to `warn` to avoid creating a local per-connection browsing-style log.

## Development

Requirements:

- Windows 10 / 11 for runtime testing.
- Node.js 24+ for development/builds.
- Administrator privileges for the current TUN/network-management architecture.

Install dependencies and run checks:

```bash
npm install
npm run check
npm test
```

Run the app:

```bash
npm start
```

Build the Windows installer after placing the required sing-box-lx files in `bin/`:

```bash
npm run build
```

Output is written to `dist/`.

## Important implementation notes

- The application still runs elevated because TUN, routes, NRPT and firewall management require administrative access in the current architecture. Moving those operations into a small privileged helper/service remains a future hardening task and should be tested on real Windows systems before deployment.
- The server radar reports reachability, not a full protocol handshake. A full end-to-end HTTP health check is performed during an actual connection before the UI reports success.
- `geoip.dat` / `geosite.dat` are not required by the current generated configuration and are intentionally not part of the lx-ready source package.

## License

MIT License. The Arrow VPN / Arrow Systems names and branding are separate trademarks.

## Security

Please see [`SECURITY.md`](./SECURITY.md) for vulnerability reporting and local-secret handling notes.
