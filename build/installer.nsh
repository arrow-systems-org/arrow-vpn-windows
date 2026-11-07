; ============================================================
; Arrow VPN - Custom NSIS Installer Hook
; ============================================================
; Este script extiende el instalador generado por electron-builder
; con dos comportamientos extra:
;
;   1. Al iniciar la instalación, detecta cualquier versión previa
;      de Arrow VPN instalada y la desinstala silenciosamente
;      antes de continuar. Esto evita que el usuario termine con
;      dos copias de la app instaladas.
;
;   2. Le pasa al uninstaller viejo una variable de entorno
;      (ARROW_UPGRADE_IN_PROGRESS) para indicarle que está siendo
;      ejecutado en el contexto de una actualización. El uninstaller
;      la lee y, si está presente, preserva la carpeta AppData
;      del usuario (credenciales, ajustes, idioma).
;
;   Si el usuario desinstala manualmente desde "Programas y
;   características" del Panel de Control, esa variable no está
;   seteada y el uninstaller sí borra AppData, como se espera
;   de una desinstalación limpia.
; ============================================================


; ------------------------------------------------------------
; HOOK: customInit
; Se ejecuta al inicio del instalador, antes de copiar archivos.
; ------------------------------------------------------------
!macro customInit

  ; --------------------------------------------------------
  ; Matamos cualquier proceso de Arrow VPN que pueda estar
  ; corriendo, para que el uninstaller silencioso no falle
  ; por archivos en uso.
  ; --------------------------------------------------------
  DetailPrint "Cerrando instancias previas de Arrow VPN..."
  nsExec::Exec 'taskkill /F /IM "Arrow VPN.exe" /T'
  nsExec::Exec 'taskkill /F /IM "sing-box.exe" /T'
  Sleep 500

  ; --------------------------------------------------------
  ; Buscamos en el registro la entrada del uninstaller de
  ; cualquier versión previa. electron-builder registra la
  ; app bajo HKLM (porque usamos perMachine: true) con el
  ; appId como clave.
  ; --------------------------------------------------------
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_REGISTRY_KEY}" "UninstallString"

  ; Si no encontramos en HKLM, probamos HKCU por si la versión
  ; vieja se instaló per-user (defensivo, no debería pasar).
  ${If} $R0 == ""
    ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ${EndIf}

  ; --------------------------------------------------------
  ; Si hay un uninstaller previo, lo ejecutamos en modo
  ; silencioso (/S) marcando que es parte de un upgrade.
  ; --------------------------------------------------------
  ${If} $R0 != ""
    DetailPrint "Detectada versión previa de Arrow VPN. Desinstalando..."

    ; Marcamos el contexto: el uninstaller leerá esta variable
    ; y, si está seteada, preservará la carpeta AppData.
    System::Call 'kernel32::SetEnvironmentVariable(t "ARROW_UPGRADE_IN_PROGRESS", t "1")'

    ; Limpiamos las comillas del UninstallString si las trae
    ; (electron-builder a veces las pone, a veces no).
    StrCpy $R1 $R0 1
    ${If} $R1 == '"'
      StrCpy $R0 $R0 "" 1
      StrCpy $R0 $R0 -1
    ${EndIf}

    ; Ejecutamos el uninstaller esperando a que termine.
    ; --uninstaller-execution-mode=upgrade es leído por
    ; nuestro hook customUnInit más abajo como señal redundante.
    ExecWait '"$R0" /S --upgrade --uninstaller-execution-mode=upgrade _?=$INSTDIR' $R2

    ; Limpiamos la variable de entorno por higiene
    System::Call 'kernel32::SetEnvironmentVariable(t "ARROW_UPGRADE_IN_PROGRESS", t 0)'

    DetailPrint "Versión previa desinstalada (código: $R2). Continuando con la instalación..."

    Sleep 1000
  ${EndIf}

!macroend


; ------------------------------------------------------------
; HOOK: customUnInit
; Se ejecuta al inicio del uninstaller, antes de borrar nada.
; Decide si esta desinstalación es un "upgrade" o un uninstall
; real del usuario, y guarda la decisión en $R9 para que el
; siguiente hook (customRemoveFiles) pueda actuar en consecuencia.
; ------------------------------------------------------------
!macro customUnInit

  ; Por defecto asumimos que es un uninstall real (usuario en
  ; Panel de Control).
  StrCpy $R9 "user"

  ; Señal 1: la variable de entorno que setea el instalador
  ; sucesor cuando nos llama desde customInit.
  ReadEnvStr $R8 "ARROW_UPGRADE_IN_PROGRESS"
  ${If} $R8 == "1"
    StrCpy $R9 "upgrade"
  ${EndIf}

  ; Señal 2: argumento de línea de comandos --upgrade.
  ; Redundante con la variable de entorno, pero útil si en algún
  ; SO/contexto la env var no se propaga correctamente.
  ${GetParameters} $R7
  ${GetOptions} $R7 "--upgrade" $R6
  ${IfNot} ${Errors}
    StrCpy $R9 "upgrade"
  ${EndIf}

  ${If} $R9 == "upgrade"
    DetailPrint "Desinstalación en modo upgrade: se preservarán los datos del usuario."
  ${Else}
    DetailPrint "Desinstalación manual: se limpiarán todos los datos."
  ${EndIf}

!macroend


; ------------------------------------------------------------
; HOOK: customRemoveFiles
; Se ejecuta durante la desinstalación, cuando electron-builder
; está borrando los archivos de la app. Aquí decidimos si
; respetamos o anulamos la opción deleteAppDataOnUninstall
; según el modo detectado en customUnInit.
; ------------------------------------------------------------
!macro customRemoveFiles

  ${If} $R9 == "upgrade"
    ; Estamos en una actualización: NO borramos AppData ni el
    ; store de electron-store. Las credenciales, ajustes,
    ; idioma y servidores guardados sobreviven a la actualización.
    DetailPrint "Modo upgrade: preservando $APPDATA\${PRODUCT_NAME}"
  ${Else}
    ; Uninstall real del usuario: borramos AppData explícitamente.
    ; Aunque deleteAppDataOnUninstall está en false en package.json
    ; (para que las actualizaciones manuales no pierdan datos),
    ; aquí limpiamos a mano porque el usuario eligió desinstalar
    ; de verdad desde Panel de Control.
    DetailPrint "Modo uninstall: limpiando datos del usuario..."

    RMDir /r "$APPDATA\${PRODUCT_NAME}"
    RMDir /r "$LOCALAPPDATA\${PRODUCT_NAME}"
    RMDir /r "$LOCALAPPDATA\${PRODUCT_NAME}-updater"

    ; Limpieza defensiva de reglas de firewall que la app pudo
    ; haber dejado (Kill Switch usa reglas con prefijo Arrow_KS_).
    nsExec::Exec 'netsh advfirewall firewall delete rule name=Arrow_KS_Block'
  ${EndIf}

!macroend
