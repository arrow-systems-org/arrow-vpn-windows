# Arrow VPN 3.1.2 — performance/lifecycle review notes

Base: the exact `3.1.1_estable.rar` supplied by the project owner after the successful 3.1.1 Windows tests. The supplied `sing-box.exe` and `libcronet.dll` were preserved unchanged; the bundled core identifies itself as sing-box-lx 1.14.1-lx.4.

## Focus of 3.1.2

This pass intentionally avoids new user-facing VPN features. It concentrates on responsiveness while retaining the 3.1.1 recovery, privacy and kill-switch protections.

- Clean tray quit is now immediate: no PowerShell/tasklist/network cleanup runs if Arrow has no active or persisted network state.
- Active quit hides the window and destroys the tray immediately, then safely restores Windows networking before Electron exits.
- The emergency synchronous cleanup no longer repeats after a successful normal cleanup.
- sing-box shutdown is event-driven and uses a short PID-targeted force-kill fallback rather than a long polling loop.
- sing-box startup resolves on the child `spawn` event; real readiness is still gated by the local proxy/TUN and the end-to-end health check.
- The renderer no longer waits 4.5 seconds after the backend reports a verified connection.
- Disconnect state is driven by an explicit main-process acknowledgement rather than a fixed 1.2-second UI timer.
- TUN discovery uses `os.networkInterfaces()` for fast polling and invokes `netsh` only as an occasional fallback.
- A persistent `network_dirty.flag` distinguishes clean sessions from interrupted/crashed sessions. Clean launches skip expensive recovery; dirty launches still run strict recovery.
- sing-box-lx version validation is cached by executable size/mtime and warmed after the UI opens.
- A 20-second radar endpoint cache can be reused by Connect, avoiding a duplicate DNS/TCP reachability pass immediately after server selection.
- Proxy, firewall, route and DNS cleanup avoid work that is not relevant to the active mode while preserving strict recovery paths.
- Temporary core config is removed only after the proxy/TUN is actually ready, avoiding a race introduced by overly aggressive fixed timers.
- `[perf]` timing markers were added to the main log for connect/disconnect/cleanup/quit bottleneck analysis without logging node addresses or credentials.

## Verification in this environment

- `npm run check`: PASS.
- `npm test`: PASS — 30/31 tests.
- `git diff --check`: PASS.
- Bundled Windows core files are still present and unmodified by this pass.
- Static inspection of `bin/sing-box.exe` identifies `1.14.1-lx.4`.

## Requires Windows validation

The following remain intentionally dependent on a real Windows machine:

- Measure real connect/disconnect/quit timings from `%APPDATA%\\arrow-vpn\\logs\\main.log` `[perf]` entries.
- Verify TUN appearance is detected correctly through `os.networkInterfaces()` on the supported Windows versions; a periodic `netsh` fallback remains in place.
- Verify Kill Switch restoration and crash recovery after forced termination.
- Build/install the NSIS package and test upgrade over 3.1.1.

The app still requests Administrator privileges as a whole. Moving privileged network operations into a small Windows service/helper remains a larger architectural hardening project and was deliberately not mixed into this performance release.
