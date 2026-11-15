# PulseCast Local

> [!WARNING]
> **Проект находится на ранней стадии разработки (Early Development / Alpha).**
> Все модули, API-маршруты, схемы профиля и нативные интеграции активно развиваются и тестируются. Возможны недоработки, баги, несовместимые изменения при обновлении версий и особенности работы на конкретном оборудовании. Используйте на тестовых трансляциях и обязательно делайте резервные копии JSON-профиля перед обновлением.

[![CI — Web & Rust Build](../../actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
[![Auto Build & GitHub Release](../../actions/workflows/release.yml/badge.svg)](../../actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Локальная автономная стриминговая студия (ориентир — единый комбайн в духе **StreamElements**, **DonationAlerts**, **Stream Avatars** и **RutonyChat**): единый пульт управления, переносимый браузерный оверлей для **OBS Studio** (`/overlay`), прямой мост **OBS WebSocket v5**, потоковые субтитры (**whisper-rs** + **cpal** + **hound**), локальный ИИ-агент с Function Calling (**llama-server** / **llama-cpp-2**), открытый Plugin SDK, 4-канальный аудио-микшер, глобальные горячие клавиши и аналитика стрима.

---

## Статус модулей (ранняя разработка)

| Подсистема | Статус | Примечание |
| --- | --- | --- |
| Веб-панель и OBS-оверлей (`/`, `/overlay`, `/obs-dock`, `/donate`) | Alpha (MVP) | Работает в Node.js/Vite и через статику Rust-сервера |
| OBS WebSocket v5 + Мастер подключения | Alpha (MVP) | SHA-256 авторизация, переключение и синхронизация сцен |
| 4-канальный аудио-микшер и горячие клавиши | Alpha (MVP) | Мастер / Алерты / TTS / Media Share + запись шорткатов |
| Аналитика эфира и экспорт CSV | Alpha (MVP) | График донатов/чата и выгрузка `/api/analytics/export.csv` |
| Персистентность профиля (`pulsecast_profile.json`) | Alpha (MVP) | Автосохранение, экспорт/импорт JSON, сброс |
| Нативное Rust-ядро (`src/*.rs`, Whisper, `llama-cpp-2`) | Early Alpha | Требует доп. тестирования на реальных устройствах и GGUF/GGML-весах |

---

## Основные возможности

- **Живое подключение OBS Studio WebSocket v5**: двусторонняя синхронизация сцен (`Main Studio`, `Gaming Capture`, `Just Chatting`, `BRB Pause`), SHA-256 аутентификация и быстрая настройка адреса.
- **Мастер быстрого старта OBS Studio**: 1-клик копирование ссылок — Единый Browser Source (`/overlay`, 1920×1080), Док-панель OBS (`/obs-dock`), Публичная страница донатов (`/donate`) и Webhook API.
- **4-канальный студийный аудио-микшер**: раздельные каналы громкости и Mute для **Мастер-шины**, **Алертов / SFX**, **TTS Озвучки** (скорость/тон) и **Media Share**.
- **Глобальные горячие клавиши**: настраиваемые комбинации (`Alt+1..4`, `Alt+M`, `Alt+S`) для пульта, сцен, клипов, пропуска медиа и звука.
- **Аналитика и экспорт CSV**: график донатов и сообщений чата, разбивка по платформам и выгрузка отчёта (`GET /api/analytics/export.csv`).
- **Мультичат, боты и SE/DA-модули**: Twitch IRC / OAuth, смайлики 7TV/BTTV/FFZ, 2D PNGTuber, Stream Avatars, Media Share, Пари (`!bet`), Слоты (`!slots`), Таблица лидеров (`!top`), RCON-вебхуки для игр и SuperThemes.

---

## Автоматическая сборка и релизы на GitHub

В репозитории настроены два GitHub Actions workflow:

1. **Непрерывная проверка сборки (`.github/workflows/ci.yml`)**
   Запускается на каждый `push` и `pull_request` в `main`/`master`:
   - Проверяет TypeScript (`npm run lint`) и production-сборку Vite (`npm run build`).
   - Проверяет компиляцию и юнит-тесты Rust (`cargo check --all-targets` и `cargo test`) на **Linux**, **Windows** и **macOS**.

2. **Автоматический релиз версий (`.github/workflows/release.yml`)**
   Собирает готовые архивы (Rust-бинарники для Linux/Windows/macOS со встроенным UI + Web/Node.js-пакет), генерирует `SHA256SUMS.txt` и автоматически публикует **GitHub Release** одним из трёх способов:
   - **По тегу**: выполните `git tag v0.1.1 && git push origin v0.1.1`.
   - **Автоматически при обновлении версии**: измените `version` в `Cargo.toml` (и синхронно в `package.json`) и запушьте в `main` — workflow сам создаст тег `v<version>` и выпустит релиз.
   - **Вручную из интерфейса GitHub**: вкладка *Actions → Auto Build & GitHub Release → Run workflow*.

> На текущей ранней стадии все релизы `0.x.y` и предрелизные теги автоматически помечаются как **Pre-release**.

---

## Быстрый старт (Веб-версия Node.js + Vite)

Требуется **Node.js 22+**.

```bash
cp .env.example .env
npm install
npm run dev
```

После запуска интерфейс доступен на `http://127.0.0.1:3000/`:
- **Пульт управления**: `http://127.0.0.1:3000/`
- **OBS Browser Source**: `http://127.0.0.1:3000/overlay`
- **OBS Custom Dock**: `http://127.0.0.1:3000/obs-dock`
- **Страница донатов**: `http://127.0.0.1:3000/donate`

Проверка типов и production-сборка:
```bash
npm run lint
npm run build
```

---

## Быстрый старт (Нативный Rust-сервер)

### 1. Системные зависимости для нативной сборки (`whisper-rs`, `llama-cpp-2`, `cpal`)
- **Ubuntu / Debian**:
  ```bash
  sudo apt-get update && sudo apt-get install -y build-essential cmake pkg-config clang libclang-dev libasound2-dev
  ```
- **macOS (Homebrew)**:
  ```bash
  brew install cmake llvm
  export LIBCLANG_PATH="$(brew --prefix llvm)/lib"
  ```
- **Windows**:
  Установите [Rust](https://rustup.rs/), [CMake](https://cmake.org/) и 64-битный [LLVM](https://releases.llvm.org/) (и задайте переменную `LIBCLANG_PATH=C:\Program Files\LLVM\bin`).

### 2. Конфигурация и опциональные локальные модели
```bash
cp .env.example .env
mkdir -p models
# Для Whisper положите GGML-модель в models/ggml-base.bin
# Для встроенного llama-cpp-2 положите GGUF-модель в models/qwen2.5-3b-instruct-q4_k_m.gguf
```
> При отсутствии файлов моделей или запущенного `llama-server` сервер стартует без ошибок и использует локальный детерминированный фоллбэк.

### 3. Сборка фронтенда и запуск Rust-сервера
```bash
npm install && npm run build
mkdir -p static && cp -r dist/* static/
cargo run --release
```
По умолчанию Rust-сервер слушает `http://127.0.0.1:8080/` (чтобы открывать пульт со смартфона по Wi-Fi, задайте `PULSECAST_HOST="0.0.0.0"` в `.env`).

---

## Эмуляция донат-вебхука (DonationAlerts / DonatePay)

```bash
curl -X POST http://127.0.0.1:3000/api/webhooks/donation \
  -H "Content-Type: application/json" \
  -d '{"username":"KiraDev","amount":500,"currency":"₽","message":"Залетай в Battle Royale!"}'
```

---

## Лицензия

Проект распространяется под лицензией [MIT](LICENSE).
