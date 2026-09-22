Arrow VPN 3.1.2 — sing-box-lx runtime
======================================

This working tree preserves the sing-box-lx runtime supplied by the project owner.
The bundled sing-box.exe identifies itself as:
  sing-box-lx 1.14.1-lx.4

Required minimum for Arrow 3.1.x:
  sing-box-lx 1.14.1-lx.4

If you replace/update the core on 64-bit Windows:
1. Download the Windows amd64 archive from the official Leadaxe/sing-box-lx release.
2. Replace BOTH files together:
     sing-box.exe
     libcronet.dll
3. Keep the existing wintun.dll and banderas folder.
4. Verify from a Windows terminal:
     bin\sing-box.exe version
   It must report an lx build at or above 1.14.1-lx.4.
5. Then run:
     npm run check
     npm test

Do not mix sing-box.exe and libcronet.dll from different lx releases.
