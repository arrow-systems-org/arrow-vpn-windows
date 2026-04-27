# Changelog

All notable changes to this project will be documented in this file.

This project follows a structured release format to track improvements, fixes, and architectural changes over time.

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
