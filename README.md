# ♟ ExtraPawn Telegram Mini App (`mini.extrapawn.com`)

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-3ecf8e.svg)](./LICENSE)
[![Telegram Bot](https://img.shields.io/badge/Telegram_Bot-@ExtraPawnTeleBot-24A1DE?logo=telegram)](https://t.me/ExtraPawnTeleBot)
[![Launch Mini App](https://img.shields.io/badge/Launch_Mini_App-ExtraPawn-b49bff?logo=telegram)](https://t.me/ExtraPawnTeleBot/miniApp)
[![Main Platform](https://img.shields.io/badge/Main_Platform-extrapawn.com-121212)](https://extrapawn.com)

Standalone viral **Telegram Mini App & Bot ecosystem** (`@ExtraPawnTeleBot`) for inter-club chess challenges across Telegram supergroups, built as part of the open-source **ExtraPawn** chess training ecosystem.

---

## 🔗 Quick Links / Быстрые ссылки

- 🤖 **Telegram Bot:** [https://t.me/ExtraPawnTeleBot](https://t.me/ExtraPawnTeleBot)
- 🚀 **Launch Telegram Mini App:** [https://t.me/ExtraPawnTeleBot/miniApp](https://t.me/ExtraPawnTeleBot/miniApp)
- 💬 **Official Community Club (`EXTRAPAWNCLUB`):** [https://t.me/EXTRAPAWNCLUB/1](https://t.me/EXTRAPAWNCLUB/1)
- 🌐 **Main Training Platform:** [https://extrapawn.com](https://extrapawn.com)
- 📦 **Mini App Repository (GitHub):** [https://github.com/ImMoSer/mini.extrapawn.com](https://github.com/ImMoSer/mini.extrapawn.com)
- 📦 **Main Platform Repository (GitHub):** [https://github.com/ImMoSer/extrapawn.com](https://github.com/ImMoSer/extrapawn.com)

---

## ✨ Key Features / Ключевые возможности

- **🏆 Rolling 30-Day Inter-Club Championship:** Connects Telegram chess supergroups (30+ members with Forum Topics enabled) into a unified 30-day leaderboard across 4 disciplines:
  1. **Tactics** (`tactics`)
  2. **Theoretical Endgames** (`theoretical_endgames`)
  3. **Practical Endgames** (`practical_chess`)
  4. **Finish Him** (`finishhim`)
- **⚖️ Fair Scoring Formula (`1 / attempts`):**
  - Solved on 1st attempt = **`1.0`** pt
  - Solved on 2nd attempt = **`0.5`** pt
  - Solved on 3rd attempt = **`0.33`** pt (`1/3`), etc.
- **🤖 Autonomous Bot & Smart Auto-Pause:**
  - Automatically creates a dedicated `ExtraPawnTeleBot` topic in connected supergroups.
  - Customizable 7-day interval schedule (`Mon–Sun`, club timezone support, per-slot discipline/difficulty/focus).
  - **Smart Auto-Pause:** Pauses scheduled posts if the current club challenge has not yet been solved or surrendered by anyone, preventing chat spam, and automatically resumes once completed.
  - **Zero-Clutter Chat Hygiene:** Renders `600×600` PNG board previews (`@resvg/resvg-js`), deletes previous challenge posts upon new publication, and auto-deletes solve notifications after 30 seconds.
- **🔬 Post-Challenge Analysis & Replays:**
  - Unlocks local in-browser **Stockfish 19 Lite WASM** (`MultiPV = 3` with WDL color-coding), **Interactive Coach** visual hints, and move-by-move replays of clubmates' solutions after solving or surrendering.
- **🌍 Multilingual UI & Bot Posts:** Full support for **Russian (`RU`)**, **English (`EN`)**, and **German (`DE`)**.

---

## 🏗 Monorepo Architecture (`pnpm` + `Turborepo`)

```text
mini.extrapawn.com/
├── packages/
│   └── shared/          # Shared TypeScript DTOs, WarmUp focus tiles, scoring formula, and Telegram startapp codec
├── apps/
│   ├── backend/         # Fastify + Drizzle ORM (PostgreSQL `tele_app` schema) + @resvg/resvg-js + Telegram Bot controller
│   └── frontend/        # Vue 3 + Vite + Tailwind CSS v4 + @lichess-org/chessground + chessops + Stockfish 19 WASM
└── docker-compose.yml   # Production stack for Dokploy (`dokploy-network`)
```

### Microservice Integrations

| Service | Internal Endpoint | Purpose |
| :--- | :--- | :--- |
| **`postgres-server`** | `postgres-server:5432` | PostgreSQL database (`chess_db`, isolated schema `tele_app.*`) |
| **`puzzle-engine`** | `http://puzzle-engine:5000` | Curated puzzle catalog (`CatalogSchemaVersion = 8`) with precomputed `puzzle_fen` |
| **`engine-hub`** | `http://engine-hub:5000` | Unified sparring system: `mozero` (`Novice`, `Pro`, `Master`) |
| **`tableservice`** | `http://tableservice:5000` | Gaviota / Syzygy endgame tablebases for positions with `<= 5` pieces |
| **WASM Stockfish 19** | Client Browser (WebWorker) | Local `MultiPV = 3` engine analysis after completing or surrendering a challenge |

---

## 🛠 Development & Validation

```bash
# Install dependencies (automatically copies Stockfish 19 WASM binaries to public/stockfish)
pnpm install

# Type-check all packages (shared, backend, frontend)
pnpm type-check

# Run ESLint across the monorepo
pnpm lint

# Build production bundles
pnpm build
```

---

## ⚡ Licenses & Credits / Лицензии и благодарности (GNU GPLv3)

This project is licensed under the **GNU General Public License v3.0** ([LICENSE](./LICENSE)), promoting transparency and growth across the chess community. In accordance with GPLv3, our source code is open and available:
- **Mini App Source Code:** [https://github.com/ImMoSer/mini.extrapawn.com](https://github.com/ImMoSer/mini.extrapawn.com)
- **Main Platform Source Code:** [https://github.com/ImMoSer/extrapawn.com](https://github.com/ImMoSer/extrapawn.com)

### 1. Stockfish 19
- **EN:** Analysis and truth-seeking are powered by [Stockfish](https://stockfishchess.org/), the world's strongest open-source chess engine (licensed under GNU GPLv3).
- **RU:** Анализ и поиск истины обеспечиваются **Stockfish** — сильнейшим в мире шахматным движком с открытым исходным кодом (GNU GPLv3).

### 2. MOZERO Sparring System & Neural Hub (Our In-House Engineering / Наша разработка)
- **EN:** Realistic sparring across all disciplines and difficulty tiers is powered by our custom in-house hybrid **MOZERO** system built on `lc0_32_1`, `Elite-Leela-v2-128x10x8h-1704000.pb.gz` weights, and a specialized Python wrapper integrated with **Syzygy & Gaviota** endgame tablebases. Special thanks to the author of [CallOn84/LeelaNets](https://github.com/CallOn84/LeelaNets) for publishing the neural network weights.
- **RU:** Реалистичный спарринг во всех дисциплинах и уровнях сложности обеспечивается нашей собственной гибридной системой **MOZERO** на базе стандартного движка `lc0_32_1`, весов `Elite-Leela-v2-128x10x8h-1704000.pb.gz` и специализированной Python-обвязки с эндшпильными базами **Syzygy & Gaviota**. Особая благодарность автору репозитория [CallOn84/LeelaNets](https://github.com/CallOn84/LeelaNets) за публикацию весов нейросети.

### 3. Leela Chess Zero (LCZero)
- **EN:** Our neural network layer runs on [LCZero](https://lczero.org/) — the pioneering engine that brought AI chess to the wider community. Huge respect to the LCZero community.
- **RU:** Наш нейросетевой слой работает на **LCZero** — новаторском движке, который открыл доступ к ИИ-шахматам широким массам. Уважение сообществу LCZero.

### 4. Chessground, Chessops & Lichess Open Database
- **EN:** Board rendering and chess logic are powered by the ultra-fast [@lichess-org/chessground](https://github.com/lichess-org/chessground) and [chessops](https://github.com/niklasf/chessops) libraries along with the [Lichess Open Database](https://database.lichess.org/). Thank you Lichess for the best chessboard renderer in the world!
- **RU:** Отрисовка доски и шахматная логика выполняются сверхбыстрым движком **Chessground & Chessops** с использованием открытой базы **Lichess Open Database**. Спасибо Lichess за лучший рендерер доски в мире!

---

## 📄 License

GNU General Public License v3.0 — see [LICENSE](./LICENSE) for full details.
