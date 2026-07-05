# Arrow VPN (Windows)

[![Version](https://img.shields.io/github/v/release/arrow-systems/arrow-vpn-windows?label=version&color=blue)](https://github.com/arrow-systems/arrow-vpn-windows/releases/latest)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
![Status](https://img.shields.io/badge/status-stable-success)
[![Engine](https://img.shields.io/badge/engine-sing--box-purple)](https://github.com/SagerNet/sing-box)

---

## Arrow VPN

Privacy-focused VPN client for Windows built by Arrow Systems.

Arrow VPN is designed to provide strong privacy, censorship resistance, and stable connectivity using modern networking technologies powered by **sing-box**.

---

## ✨ Features

- 🔗 **Subscription-link based activation** — paste a single URL to activate, no UUID or password
- 🔒 No-logs philosophy
- 🌍 Multi-server global routing
- ⚡ Real-time latency radar
- 🧠 Smart connection handling
- 🛡️ Kill Switch support
- 🔀 Dual mode:
    - TUN (full system VPN)
    - Proxy mode (local)
- 🧬 IPv4 + IPv6 support (dual stack)
- 🕵️‍♂️ Advanced censorship evasion (VLESS + Reality / TLS)
- 🌐 Multilingual UI — English, Spanish, Russian
- 🏳️ Local flag cache with offline fallback bundled in the installer
- 🔄 Silent subscription refresh on launch
- 🔐 Subscription link stored encrypted on disk via Windows DPAPI (`safeStorage`)
- 🧩 Modern architecture powered by **sing-box**

---

## 🚀 Getting Started

After installing the app:

1. Open Arrow VPN.
2. Paste your **subscription link** (provided when you sign up) in the activation field.
3. The app fetches the link, loads your available servers, and shows your plan status.
4. Pick a server and connect.

The subscription link is encrypted locally with Windows DPAPI and bound to your Windows user account — you only need to paste it once per machine.

---

## 🧱 Architecture

Arrow VPN uses:

- **Electron** — UI and application layer
- **sing-box** — networking engine
- **VLESS + Reality** — secure transport protocol with strong DPI evasion
- **TUN interface** — for system-wide routing
- **Subscription-based account model** — server list and expiration metadata fetched from a single subscription URL
- **Windows DPAPI** (`safeStorage`) — for at-rest encryption of the subscription link

---

## ⚙️ Requirements

- Windows 10 / 11
- Administrator privileges (required for TUN mode)
- Internet access

---

## 🚀 Development

Clone the repository:

```
git clone https://github.com/arrow-systems/arrow-vpn-windows.git
cd arrow-vpn-windows
```

Install dependencies:

```
npm install
```

Run the app:

```
npx electron .
```

---

## 🏗️ Build

To build the Windows installer:

```
npm run build
```

Output directory:

```
/dist
```

---

## 📦 Releases

Pre-built binaries are available here:

https://github.com/arrow-systems/arrow-vpn-windows/releases

---

## 🧠 Notes

- After major networking changes, browsers (especially Firefox) may require:
    - DNS cache clearing
    - HTTP connection reset
- IPv6 support depends on network environment
- TUN mode requires administrator privileges
- The encrypted subscription link is tied to the current Windows user and machine. Moving the user profile to a different machine requires re-pasting the subscription link.

---

## ⚖️ License

MIT License

---

## ™ Trademark Notice

The name **Arrow VPN** and **Arrow Systems** are trademarks.

You may use, modify, and distribute the code under MIT License terms,
but you may not use the name or branding without permission.

---

## 🌐 About

Arrow Systems focuses on privacy tools designed for real-world conditions, including restricted networks and censorship-heavy environments.

---

## ⚠️ Disclaimer

This software is provided "as is", without warranty of any kind.

Use responsibly and in accordance with your local laws.