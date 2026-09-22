# Security Policy

## Reporting a Vulnerability

Please report security issues privately to:

`bug@arrow-x.org`

Include a description, reproduction steps, affected version and expected impact when possible.

## Local secret handling

Arrow 3.1 stores the subscription URL and node definitions encrypted through Electron `safeStorage` (Windows DPAPI). Raw node URIs are kept in the main process and are not exposed to the renderer UI. If secure storage is unavailable, new secrets are not silently written in plaintext.

Remote subscription URLs must use HTTPS. Arrow also checks the final URL after redirects so an HTTPS source cannot silently downgrade to HTTP.

The temporary sing-box configuration contains node credentials while the core starts. Arrow deletes that generated config after the core has loaded it and uses restrictive file permissions where supported. The runtime traffic log defaults to `warn` rather than `info` to minimize locally retained browsing metadata.

## Privileges

The current Windows application runs elevated because it manages TUN interfaces, routes, NRPT DNS policy and firewall rules. Treat renderer/main-process isolation as security-critical and keep Electron current. A future privileged-helper split would reduce the impact of a renderer compromise but requires dedicated Windows integration testing.
