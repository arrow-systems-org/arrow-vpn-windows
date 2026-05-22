# Changelog

All notable changes to this project will be documented in this file.

This project follows a structured release format to track improvements, fixes, and architectural changes over time.

---

## Arrow VPN v2.0.19

This release completes the internationalization effort by extending translation coverage to the main process layer (tray menu, system dialogs, IPC error messages) and adds full **Russian** language support. It also introduces single-instance enforcement with safe handling across OTA updates.

---

### ✨ Highlights

* Full Russian (Русский) UI and system-level translations
* Complete i18n coverage in the main process: tray menu, OTA dialogs, IPC error messages
* Single-instance enforcement with automatic window focus and user notification on duplicate launch attempts
* Safe OTA relaunch handling to prevent edge cases during version transitions
* Live tray menu rebuild on language change without restart

---

### Improvements

* Added a third UI language: **Russian (Русский)**, with full coverage across UI strings and system-level messages.
* Implemented a complete i18n layer in the main process: tray menu, update dialogs, OS notifications, IPC error messages, and connection state messages now all follow the selected language.
* The tray menu is now rebuilt live when the user changes language, eliminating the need to restart the app for the change to take effect on system-level UI.
* Refactored ping radar state codes from localized strings to stable internal identifiers (`optimal`, `high_latency`, `overloaded`, `down`, `timeout`, `url_error`), decoupling backend logic from UI language and enabling reliable state comparison regardless of locale.
* The `<html lang>` attribute now updates dynamically alongside the UI language for proper accessibility behavior and consistent `Intl.DisplayNames` country resolution.
* Extended `data-i18n-title` attribute support to allow translation of HTML tooltip attributes (e.g. the PROXY mode hint).
* Country name display overrides (US → USA / EE. UU. / США) are now fully language-aware via the i18n dictionary.
* Extended the translation function with parameter interpolation support for dynamic strings (e.g. server names embedded in clipboard confirmation toasts).

---

### Fixes

* Fixed the tray menu remaining in Spanish regardless of the selected UI language.
* Fixed the OTA update dialog appearing in Spanish regardless of the selected UI language.
* Fixed engine error messages, login errors, and subscription validation errors appearing in Spanish when using the English UI.
* Fixed connection-loss notifications (including kill-switch warnings) not respecting the selected language.

---

### ⚠️ Notes

* Only one instance of Arrow VPN can run at a time. Attempting to launch a second instance now focuses the existing window and displays a localized notification, instead of opening a duplicate window.
* During OTA "Install and Restart", the single-instance lock is now explicitly released before relaunch, preventing edge cases where the newly installed version could fail to start due to a stale lock from the previous process.
* Server-side messages received from the API (e.g. invalid credentials, inactive subscription) are still rendered using the text returned by the backend. Localization of these specific messages will be addressed in a future server-side update.

---

## Русская версия
## Arrow VPN v2.0.19

Этот релиз завершает работу по интернационализации, распространяя поддержку перевода на основной процесс приложения (меню в системном трее, системные диалоги, сообщения об ошибках IPC), и добавляет полную поддержку **русского** языка. Также внедрено обеспечение запуска единственного экземпляра приложения с корректной обработкой во время OTA-обновлений.

---

### ✨ Основные особенности

* Полная поддержка русского (Русский) интерфейса и системных сообщений
* Полный охват i18n в основном процессе: меню в трее, диалоги OTA, сообщения об ошибках IPC
* Контроль единственного экземпляра приложения с автоматическим фокусом окна и уведомлением пользователя при попытке повторного запуска
* Безопасная обработка перезапуска OTA для предотвращения сбоев при переходе между версиями
* Динамическое обновление меню в трее при смене языка без перезапуска

---

### Улучшения

* Добавлен третий язык интерфейса: **русский (Русский)**, с полным охватом строк UI и системных сообщений.
* Реализован полноценный слой i18n в основном процессе: меню в трее, диалоги обновления, системные уведомления, сообщения об ошибках IPC и сообщения о состоянии подключения теперь следуют выбранному языку.
* Меню в трее теперь перестраивается «вживую» при смене языка пользователем — больше не требуется перезапуск приложения для применения изменений на системном уровне.
* Состояния радара пинга переведены со строк, зависящих от языка, на стабильные внутренние идентификаторы (`optimal`, `high_latency`, `overloaded`, `down`, `timeout`, `url_error`), что отделяет внутреннюю логику от языка интерфейса и обеспечивает надёжное сравнение состояний независимо от локали.
* Атрибут `<html lang>` теперь динамически обновляется вместе с языком интерфейса для корректного поведения средств доступности и стабильной работы `Intl.DisplayNames` при определении названий стран.
* Расширена поддержка атрибута `data-i18n-title` для перевода всплывающих HTML-подсказок (например, подсказки для режима PROXY).
* Локальные переопределения названий стран (US → USA / EE. UU. / США) теперь полностью управляются через словарь i18n.
* Функция перевода расширена поддержкой параметров для динамических строк (например, для встраивания названий серверов в уведомления о копировании в буфер обмена).

---

### Исправления

* Исправлена проблема, при которой меню в трее оставалось на испанском языке независимо от выбранного языка интерфейса.
* Исправлена проблема, при которой диалог OTA-обновления отображался на испанском языке независимо от выбранного языка интерфейса.
* Исправлено отображение сообщений об ошибках движка, ошибок входа и ошибок проверки подписки на испанском языке при использовании английского интерфейса.
* Исправлены уведомления о потере соединения (включая предупреждения Kill Switch), не учитывавшие выбранный язык.

---

### ⚠️ Примечания

* Одновременно может быть запущен только один экземпляр Arrow VPN. При попытке запустить второй экземпляр теперь фокусируется существующее окно и показывается локализованное уведомление, вместо открытия дублирующего окна.
* При выборе «Установить и перезапустить» во время OTA-обновления блокировка единственного экземпляра теперь явно освобождается перед перезапуском, что предотвращает редкие случаи, когда установленная новая версия могла не запуститься из-за неосвобождённой блокировки предыдущего процесса.
* Сообщения, поступающие со стороны сервера API (например, неверные учётные данные, неактивная подписка), по-прежнему отображаются в том виде, в каком они возвращаются бэкендом. Локализация этих сообщений будет реализована в будущем обновлении на стороне сервера.

---

## Arrow VPN v2.0.16

This release introduces full internationalization support, featuring a dynamic UI translation engine and seamless multilingual server localization, along with important UI refinements and under-the-hood framework updates.

---

### ✨ Highlights

* Full English and Spanish UI support with instant switching
* Dynamic server name translation using native OS APIs (`Intl.DisplayNames`)
* Premium glassmorphism language selector
* Improved floating panel layouts for better screen adaptability
* Core framework security update

---

### Improvements

* Implemented a completely new i18n system allowing users to switch interface languages instantly without restarting the application.
* Server names are now dynamically translated and sorted alphabetically based on the user's selected language, utilizing backend-provided ISO country codes.
* Redesigned the settings panel: replaced the native Windows OS dropdown with a custom, animated glassmorphism select menu to match the premium dark theme.
* Optimized the floating panels' layout (adjusted padding and added max-height constraints) to perfectly fit screens without overlapping the top title bar.
* Updated the core `electron` framework to v40.9.2 for enhanced security and stability, while carefully maintaining CommonJS compatibility.

---

### Fixes

* Fixed an aesthetic issue where the settings and support panels could touch or overflow the top window edge on certain scaling configurations.
* Fixed the display of long server names by ensuring proper text capitalization and UI spacing.

---

## Русская версия
## Arrow VPN v2.0.16

Этот релиз добавляет полную поддержку интернационализации, представляя движок динамического перевода пользовательского интерфейса и локализации серверов, а также важные визуальные улучшения и обновление базового фреймворка.

---

### ✨ Основные особенности

* Полная поддержка английского и испанского интерфейса с мгновенным переключением
* Динамический перевод названий серверов с использованием нативных API ОС (`Intl.DisplayNames`)
* Премиальный селектор языка в стиле glassmorphism
* Улучшенная компоновка плавающих панелей для лучшей адаптивности экрана
* Обновление безопасности базового фреймворка

---

### Улучшения

* Внедрена совершенно новая система i18n, позволяющая мгновенно переключать язык интерфейса без перезапуска приложения.
* Названия серверов теперь переводятся динамически и сортируются по алфавиту в зависимости от выбранного пользователем языка с использованием ISO-кодов стран, предоставляемых бэкендом.
* Переработана панель настроек: стандартный выпадающий список Windows заменен на кастомное анимированное меню в стиле glassmorphism, соответствующее темной премиальной теме.
* Оптимизирована компоновка плавающих панелей (скорректированы отступы и добавлено ограничение по максимальной высоте), чтобы они идеально помещались на экране, не перекрывая верхнюю строку заголовка.
* Базовый фреймворк `electron` обновлен до версии 40.9.2 для повышения безопасности и стабильности (с сохранением совместимости CommonJS).

---

### Исправления

* Исправлена эстетическая проблема, из-за которой панели настроек и поддержки могли касаться верхнего края окна или выходить за его пределы при определенных масштабах экрана.
* Исправлено отображение длинных названий серверов: обеспечена правильная капитализация текста и интервалы в интерфейсе.

---

## Arrow VPN v2.0.15

Fixes and improvements

---

## Arrow VPN v2.0.14

This release focuses on desktop security hardening, routing refinements, and startup reliability improvements.

It introduces mitigations for a localhost proxy exposure class affecting clients that unnecessarily expose a local proxy while running in VPN/TUN mode, while also improving error handling and connection validation across both VPN and Proxy modes.

* * *

### ✨ Highlights

* Security hardening for VPN/TUN mode
* Improved separation between full VPN mode and local proxy mode
* Cleaner error reporting in the application UI
* Better diagnostic logging for troubleshooting
* Safer handling of RU-domain direct routing

* * *

### Improvements

* Removed the unnecessary local `mixed` inbound while running in VPN mode, reducing local attack surface
* Improved startup flow separation between Proxy mode and VPN mode
* Added dedicated `app_error.log` logging for detailed diagnostics
* Refined connection validation logic during engine startup
* Improved routing behavior for region-specific direct traffic (`.ru`, `.su`, `.рф`)

* * *

### Fixes

* Fixed false startup errors caused by checking a local proxy port in VPN mode
* Fixed noisy error propagation that dumped full technical logs directly into the app interface
* Fixed startup sequence issues where system proxy handling could be applied too early
* Fixed UI error feedback to display short user-friendly messages instead of raw engine logs

* * *

### ⚠️ Notes

* This release mitigates a localhost proxy exposure class, but should be considered a hardening update rather than a complete solution for every client architecture
* Proxy mode still uses a local inbound by design
* VPN/TUN mode no longer exposes an unnecessary local proxy listener
* Administrator privileges are still required for TUN mode

* * *

### Acknowledgements

Special thanks to @runetfreedom for publicly documenting and drawing attention to this class of proxy exposure issues, which helped inform this hardening work.

* * *

## Русская версия
## Arrow VPN v2.0.14

Этот релиз посвящён усилению безопасности настольного клиента, улучшению маршрутизации и повышению надёжности запуска.

В нём реализованы меры по снижению риска, связанного с классом уязвимостей localhost proxy exposure у клиентов, которые без необходимости поднимают локальный прокси при работе в режиме VPN/TUN. Также улучшены обработка ошибок и проверка состояния соединения в режимах VPN и Proxy.

* * *

### ✨ Основные особенности

* Усиление безопасности режима VPN/TUN
* Улучшено разделение между полным VPN-режимом и локальным прокси-режимом
* Более чистое отображение ошибок в интерфейсе приложения
* Улучшенное диагностическое логирование
* Более безопасная обработка direct-маршрутизации для RU-доменов

* * *

### Улучшения

* Удалён лишний локальный `mixed` inbound в режиме VPN, что уменьшает локальную поверхность атаки
* Улучшен процесс запуска и разделение логики между режимами Proxy и VPN
* Добавлен отдельный журнал `app_error.log` для подробной диагностики
* Улучшена проверка состояния соединения при запуске движка
* Скорректирована маршрутизация для direct-трафика на региональные домены (`.ru`, `.su`, `.рф`)

* * *

### Исправления

* Исправлены ложные ошибки запуска, вызванные проверкой локального proxy-порта в режиме VPN
* Исправлена избыточная передача технических логов прямо в интерфейс приложения
* Исправлены проблемы последовательности запуска, при которых системный прокси мог применяться слишком рано
* Исправлено отображение ошибок: теперь приложение показывает короткие понятные сообщения вместо сырых логов движка

* * *

### ⚠️ Примечания

* Данный релиз снижает риск, связанный с классом localhost proxy exposure, но должен рассматриваться как hardening-обновление, а не как универсальное полное решение для всех архитектур клиентов
* Режим Proxy по-прежнему использует локальный inbound по своей архитектуре
* Режим VPN/TUN больше не поднимает лишний локальный proxy listener
* Для режима TUN по-прежнему требуются права администратора

* * *

### Благодарности

Отдельная благодарность @runetfreedom за публичное описание и освещение данного класса проблем proxy exposure, что помогло сформировать это обновление безопасности.

---

## [v2.0.13] - 2026-04-10

### 🚀 Initial Stable Release (sing-box)

This version marks the first stable release after migrating from Xray-core to sing-box, focusing on stability, IPv6 support, and modern DNS/routing behavior.

---

### Fixed

- Fixed sing-box startup failures caused by deprecated DNS configuration
- Fixed legacy DNS server incompatibility with newer sing-box versions
- Fixed missing `domain_resolver` configuration in routing
- Fixed proxy mode local port mismatch
- Fixed incorrect connection state reporting (false “connected”)
- Fixed TUN initialization issues on Windows systems
- Fixed IPv6 detection problems in VPN mode
- Fixed WebSocket failures in packet loss tests
- Fixed upload failures in speed tests
- Fixed browser-related issues caused by stale DNS and connection cache

---

### Improved

- Improved sing-box startup and process lifecycle handling
- Improved connection readiness validation before marking VPN as active
- Improved DNS handling for dual-stack environments (IPv4 + IPv6)
- Improved routing behavior (reduced aggressive IPv6 forcing)
- Improved TUN stability and compatibility with Windows networking
- Improved performance for WebSocket and upload-heavy traffic
- Improved logging and diagnostics for troubleshooting

---

### Added

- Added runtime logging for sing-box (stdout and stderr)
- Added startup validation checks for connection reliability
- Added dual-stack aware DNS resolution (IPv6 preferred with fallback)
- Added improved error visibility for debugging connection issues

---

### Technical Notes

- MTU tuning may affect stability depending on the network environment
- IPv6 is supported but not strictly forced to avoid unstable routes
- Browsers may require cache clearing after major networking changes

---

### Migration Summary

- Migrated networking core from **Xray** → **sing-box**
- Updated configuration format to match latest sing-box requirements
- Reworked DNS and routing logic for modern compatibility
- Improved overall stability and connection reliability

---

## [v2.0.12] - 2026-04-06

### Initial Public Version

- First public release of Arrow VPN Windows client
- Basic UI and connection system
- Xray-based networking engine
