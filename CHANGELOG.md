# Changelog

All notable changes to this project will be documented in this file.

This project follows a structured release format to track improvements, fixes, and architectural changes over time.

---

## Arrow VPN v2.0.20

This release introduces a major shift in how Arrow VPN handles user accounts: the app moves away from the legacy UUID + password login model and adopts a **subscription-link based** model. Users now activate the app by pasting a single subscription URL, which the app fetches, decodes, and uses to populate the server list automatically. This release also brings a redesigned subscription status card, rectangular country flags with local caching, and a one-tap copy button for the encrypted subscription link.

---

### ✨ Highlights

* New subscription-link based activation model — no more UUID and password
* Server list is now built dynamically from the user's subscription
* Encrypted local storage of the subscription URL using Windows DPAPI (`safeStorage`)
* Redesigned subscription status card with adaptive expiration badge (Active / Expires soon / Unlimited / Expired)
* Rectangular country flags with local cache and offline fallback bundled with the app
* One-click button to copy the user's subscription link to the clipboard
* Silent background refresh of the subscription when the app opens

---

### Improvements

* Replaced the UUID + password login screen with a single "activate with subscription link" flow. The pasted URL is fetched, decoded from base64, and parsed into a structured list of servers — including country emoji, ISO code, English name and Russian name extracted from each server entry.
* Subscription URLs are now stored encrypted on disk using Electron's `safeStorage` (DPAPI on Windows), bound to the current Windows user and machine. The plaintext link never touches the renderer process; decryption happens only in the main process when needed.
* Implemented a redesigned subscription status card that displays days remaining alongside a color-coded badge: green for active, yellow when expiration is near, blue for unlimited plans, and red when expired. All states are fully translated across the three supported languages (English, Spanish, Russian).
* Country flags are now rendered as crisp rectangular SVGs instead of emoji. A cascading resolution strategy was implemented: first look in the per-user app cache, then attempt download from `arrow-x.org/banderas`, and finally fall back to the SVGs bundled inside the app installer (`bin/banderas`). Once resolved, every flag is cached locally, so subsequent launches are instant and work offline.
* Added a "Copy subscription link" button that decrypts the stored URL in the main process and writes it to the system clipboard, without exposing the link to the page DOM or renderer console.
* Added a silent subscription refresh on app launch: the app re-fetches the subscription in the background to pick up newly added servers, updated expiration dates, and traffic counters, without interrupting the user.
* Server entries are now parsed with ISO country codes derived from the flag emoji embedded in each `vless://` fragment name (using the Regional Indicator Symbol range), enabling consistent flag rendering and translation regardless of UI language.
* The subscription parser is tolerant to both base64-encoded and plaintext subscription bodies, and gracefully ignores malformed lines.
* The traffic counter and expiration metadata are read from the standard `subscription-userinfo` header returned by the subscription endpoint.

---

### Fixes

* Fixed the language selector not repainting the subscription status card on language change. The card now refreshes its labels and badge text live, alongside the rest of the UI.
* Fixed flag rendering failing for servers whose `data` payload did not carry a pre-resolved flag path. Flag resolution is now performed centrally from the ISO code returned by the subscription parser, removing dependency on backend-provided flag metadata.
* Fixed the "Copy subscription link" action failing when invoked from the renderer. The copy operation is now handled entirely in the main process via a dedicated IPC channel, ensuring the encrypted link is decrypted and copied without ever leaving the main process.
* Fixed missing translation keys (`SUB-ESTADO-*`) showing as raw identifiers in some locales. The full set of subscription-status keys is now defined in all three languages.

---

### ⚠️ Notes

* **Users updating from v2.0.19 to v2.0.20 will need to re-activate the app once** by pasting their subscription link. After this one-time activation, the link is stored encrypted and the app will not prompt for it again on subsequent launches.
* The subscription link is encrypted with Windows DPAPI, which ties decryption to the current Windows user and machine. If the user profile is migrated to another machine, the app will prompt for the subscription link again.
* Subscription refresh happens automatically on launch. There is no manual "refresh" button in the UI; the existing in-app actions (activate / replace subscription) already cover all explicit refresh scenarios.
* This release does not change the connection engine (sing-box) or the connection protocol (VLESS + Reality). All existing servers continue to work exactly as before; only the account / activation layer has changed.

---

## Русская версия
## Arrow VPN v2.0.20

Этот релиз вносит крупное изменение в способ управления учётными записями: приложение отходит от старой модели входа по UUID + паролю и переходит на модель **по ссылке подписки**. Теперь активация выполняется вставкой одной ссылки подписки, которую приложение само загружает, расшифровывает и использует для автоматического построения списка серверов. Также переработана карточка статуса подписки, добавлены прямоугольные флаги стран с локальным кэшированием и кнопка копирования зашифрованной ссылки подписки в один клик.

---

### ✨ Основные особенности

* Новая модель активации по ссылке подписки — больше никаких UUID и паролей
* Список серверов теперь строится динамически из подписки пользователя
* Зашифрованное локальное хранение ссылки подписки с использованием Windows DPAPI (`safeStorage`)
* Переработанная карточка статуса подписки с адаптивным значком срока действия (Активна / Скоро истекает / Безлимитная / Истекла)
* Прямоугольные флаги стран с локальным кэшем и автономным резервом, упакованным в приложение
* Кнопка копирования ссылки подписки в буфер обмена в один клик
* Тихое фоновое обновление подписки при открытии приложения

---

### Улучшения

* Экран входа по UUID + паролю заменён единым потоком «активация по ссылке подписки». Вставленная ссылка загружается, декодируется из base64 и разбирается в структурированный список серверов — с эмодзи страны, ISO-кодом, английским и русским названием, извлекаемыми из каждой записи сервера.
* Ссылки подписки теперь хранятся на диске в зашифрованном виде с использованием `safeStorage` Electron (DPAPI в Windows), привязанные к текущему пользователю Windows и машине. Открытая ссылка никогда не попадает в renderer-процесс; расшифровка выполняется только в основном процессе и только при необходимости.
* Реализована переработанная карточка статуса подписки, отображающая оставшиеся дни вместе с цветным значком: зелёный для активной, жёлтый при близком истечении, синий для безлимитных тарифов и красный для истёкшей. Все состояния полностью переведены на три поддерживаемых языка (английский, испанский, русский).
* Флаги стран теперь отображаются как чёткие прямоугольные SVG вместо эмодзи. Реализована каскадная стратегия разрешения: сначала кэш приложения для текущего пользователя, затем попытка загрузки с `arrow-x.org/banderas`, и наконец резервный набор SVG, упакованный в установщик приложения (`bin/banderas`). После разрешения каждый флаг кэшируется локально, поэтому последующие запуски мгновенны и работают офлайн.
* Добавлена кнопка «Копировать ссылку подписки», которая расшифровывает сохранённую ссылку в основном процессе и записывает её в системный буфер обмена, не выставляя ссылку в DOM страницы или консоль renderer-процесса.
* Добавлено тихое обновление подписки при запуске: приложение в фоне повторно загружает подписку, чтобы подхватить новые серверы, обновлённые даты истечения и счётчики трафика, не прерывая пользователя.
* Записи серверов теперь разбираются с ISO-кодами стран, выведенными из эмодзи флага в имени каждой записи `vless://` (с использованием диапазона Regional Indicator Symbol), что обеспечивает согласованное отображение флагов и перевода независимо от языка интерфейса.
* Парсер подписки устойчив к телам подписки как в формате base64, так и в виде открытого текста, и корректно игнорирует некорректные строки.
* Счётчик трафика и метаданные срока действия читаются из стандартного заголовка `subscription-userinfo`, возвращаемого эндпоинтом подписки.

---

### Исправления

* Исправлено: селектор языка не перерисовывал карточку статуса подписки при смене языка. Карточка теперь «вживую» обновляет свои подписи и текст значка вместе с остальным интерфейсом.
* Исправлено: отображение флага не работало для серверов, чьи данные `data` не содержали заранее разрешённого пути к флагу. Разрешение флагов теперь выполняется централизованно по ISO-коду, возвращённому парсером подписки, что снимает зависимость от метаданных флагов со стороны бэкенда.
* Исправлено: действие «Копировать ссылку подписки» не срабатывало при вызове из renderer-процесса. Операция копирования теперь полностью обрабатывается в основном процессе через выделенный IPC-канал, что гарантирует расшифровку и копирование ссылки без её попадания за пределы основного процесса.
* Исправлены отсутствующие ключи перевода (`SUB-ESTADO-*`), отображавшиеся как сырые идентификаторы в некоторых локалях. Полный набор ключей статуса подписки теперь определён на всех трёх языках.

---

### ⚠️ Примечания

* **Пользователям, обновляющимся с v2.0.19 до v2.0.20, потребуется один раз повторно активировать приложение**, вставив свою ссылку подписки. После этой однократной активации ссылка сохраняется в зашифрованном виде, и приложение больше не будет запрашивать её при последующих запусках.
* Ссылка подписки шифруется через Windows DPAPI, что привязывает расшифровку к текущему пользователю Windows и машине. При переносе профиля пользователя на другую машину приложение снова попросит ввести ссылку подписки.
* Обновление подписки происходит автоматически при запуске. В интерфейсе нет отдельной кнопки «обновить»; существующие действия в приложении (активировать / заменить подписку) уже покрывают все сценарии явного обновления.
* Этот релиз не меняет движок подключения (sing-box) и протокол подключения (VLESS + Reality). Все существующие серверы продолжают работать ровно так же, как и раньше; изменился только слой учётной записи / активации.

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
