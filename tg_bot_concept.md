# ExtraPawn Telegram Mini App (`mini.extrapawn.com`) — Архитектура и Межсессионная Память

> **Назначение документа:** Актуальная архитектурная документация, справочник API/БД и межсессионная память для проекта **ExtraPawn Telegram Mini App** (`@ExtraPawnTeleBot`).
> **Репозиторий GitHub:** `https://github.com/ImMoSer/mini.extrapawn.com.git`
> **Локальная директория:** `C:\MY_APPS\CHESS_APP\EXTRAPAWN_MINI`
> **Лицензия:** GNU GPLv3 (`LICENSE`)

---

## 1. Видение и Разделение Продуктов (Separation of Concerns)

1. **Основная платформа (`extrapawn.com` / `app_vue` + `app_fastify`)**:
   - Чистый профессиональный Тренировочный Центр и Платформа Курсов с авторизацией через Lichess OAuth2.
   - Вся легаси-логика челленджей (маршруты `/challenge/*`, стор `challenge.store.ts`, прокси-роуты `/training/challenges/*`, хендлер `challenge.go` в `puzzle_service` и таблица `puzzle_service.challenge_attempts`) полностью удалена из основного приложения.
2. **Вирусное Telegram Mini App (`mini.extrapawn.com` / `EXTRAPAWN_MINI`)**:
   - Автономное приложение для проведения шахматных челленджей в шахматных клубах (супергруппах Telegram с включёнными темами).
   - **Авторизация:** Исключительно через Telegram WebApp (`Telegram.WebApp.initData` с криптографической проверкой `HMAC-SHA256`), мгновенный вход в 0 кликов.
   - **Суперадмин платформы (SuperAdmin):** Пользователь с `telegram_id = "5106981885"` имеет эксклюзивный доступ к панели `/super-admin` для мониторинга всех подключённых клубов, блокировки/разблокировки (`blocked` / `active`), принудительного выхода бота из групп и рассылки промо-кампаний.
   - **Дефолтный (родной) клуб:** Супергруппа **EXTRAPAWNCLUB** (`chat_id = "-1002255301933"`, `https://t.me/EXTRAPAWNCLUB/293770`, топик `ExtraPawnTeleBot`, `message_thread_id = 293770`, владелец `5106981885`). Автоматически создаётся при старте бэкенда (`bootstrapDatabase()`).
   - **Полная автономность от `n8n` и `stockfish_server`:** Бэкенд Mini App самостоятельно управляет ботом `@ExtraPawnTeleBot` (через нативный `fetch` к Telegram Bot API), расписаниями клубов, рендерингом PNG-картинок стартовой позиции (`board.png` через `@resvg/resvg-js`), закреплением постов (`pinChatMessage`) и отправкой реплаев при решении.

---

## 2. Структура Монорепозитория и Внешние Сервисы

### 2.1. Дерево проекта `EXTRAPAWN_MINI` (`pnpm` + `Turborepo`)
```text
C:\MY_APPS\CHESS_APP\EXTRAPAWN_MINI/
├── apps/
│   ├── backend/                              # Fastify 4 + TypeScript + Drizzle ORM + @resvg/resvg-js
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── index.ts                      # Точка входа Fastify + запуск циклов бота
│   │       ├── config/env.ts                 # Fail-Fast валидация переменных окружения
│   │       ├── db/
│   │       │   ├── schema.ts                 # Drizzle-схема `tele_app.*` (5 таблиц)
│   │       │   └── index.ts                  # Пул postgres + идемпотентный bootstrapDatabase()
│   │       ├── plugins/
│   │       │   └── telegramAuth.ts           # Проверка HMAC-SHA256 Telegram initData + upsert юзера
│   │       ├── bot/
│   │       │   └── telegramBot.service.ts    # Long-polling бот, расписание клубов, публикация и пин
│   │       ├── services/
│   │       │   ├── boardImage.service.ts     # Генератор PNG 600x600 (SVG -> PNG через Resvg)
│   │       │   ├── puzzleClient.service.ts   # Клиент к puzzle_service:5000 (готовый puzzle_fen)
│   │       │   ├── engineClient.service.ts   # Клиент к engine-hub:5000 (Maia/MOZERO) и tableservice:5000
│   │       │   └── clubMapper.ts             # Маппинг строки клуба в ClubSummaryDTO
│   │       └── routes/
│   │           ├── cabinet.routes.ts         # GET /api/cabinet, PATCH /api/cabinet/language
│   │           ├── challenges.routes.ts      # Доска, лидерборд задачи/клуба, attempt, surrender
│   │           ├── clubs.routes.ts           # Межклубный чемпионат /api/clubs/leaderboard, настройки клуба
│   │           ├── engine.routes.ts          # Прокси ходов бота (/api/engine/move) и таблиц (/api/engine/tablebase)
│   │           └── superadmin.routes.ts      # Управление клубами и промо-кампаниями (/api/superadmin/*)
│   └── frontend/                             # Vue 3 + Vite + Tailwind CSS v4 + Feature-Sliced Design
│       ├── Dockerfile                        # Мультистейдж сборка (node:24-alpine -> nginx:alpine)
│       ├── nginx.conf                        # Раздача SPA + проксирование /api/* на mini-backend:3000
│       └── src/
│           ├── app/                          # Инициализация Vue, Pinia, Vue Router + декодер startapp
│           ├── pages/
│           │   ├── cabinet/                  # UserCabinetPage.vue (/cabinet)
│           │   ├── clubs/                    # ClubsLeaderboardPage.vue (/clubs — чемпионат за 30 дней)
│           │   ├── challenge/                # ChallengePlayPage.vue (/challenge/...)
│           │   ├── records/                  # ClubRecordsPage.vue & TaskRecordsPage.vue
│           │   ├── club-settings/            # ClubSettingsPage.vue (/club-settings/:chatId)
│           │   └── super-admin/              # SuperAdminPage.vue (/super-admin)
│           ├── widgets/
│           │   ├── navigation/               # TopNavBar.vue (навигация + переключатель RU/EN/DE)
│           │   └── challenge-board/          # InteractiveChessground.vue
│           ├── entities/
│           │   └── cabinet/                  # cabinet.store.ts
│           └── shared/
│               ├── api/                      # httpClient.ts (авто-прикрепление X-Telegram-Init-Data)
│               ├── config/                   # telegram.ts (интеграция с Telegram WebApp SDK)
│               ├── i18n/                     # useI18n.ts (словари RU / EN / DE)
│               └── lib/                      # useLocalStockfish.ts (WebWorker Stockfish 19 WASM)
├── packages/
│   └── shared/                               # Общие типы, DTO, плитки WarmUp, формула очков и кодек startapp
├── docker-compose.yml                        # Стек mini-backend + mini-frontend в dokploy-network
├── .env_local                                # Локальное окружение (в .gitignore)
├── .env_dokploy                              # Продакшен-переменные для Dokploy (в .gitignore)
└── tg_bot_concept.md                         # Данный документ
```

> **WASM Stockfish 19:** Бинарные файлы `stockfish-19-single.js` и `stockfish-19-single.wasm` (94.5 МБ) **не хранятся в Git** (`apps/frontend/public/stockfish/` добавлен в `.gitignore`). Они автоматически копируются из `node_modules/stockfish/bin/` скриптами `postinstall` и `prebuild` (`pnpm run copy-stockfish` в `apps/frontend/package.json`).

### 2.2. Интеграция с микросервисами (`dokploy-network`)
| Сервис | Внутренний URL (Dokploy) | Локальный порт | Назначение в `EXTRAPAWN_MINI` |
| :--- | :--- | :--- | :--- |
| **`postgres-server`** | `postgres-server:5432` | `127.0.0.1:5432` | БД `chess_db`, изолированная схема **`tele_app.*`** |
| **`puzzle-engine`** | `http://puzzle-engine:5000` | `http://127.0.0.1:5001` | Каталог задач SQLite v8 с предрассчитанным полем `puzzle_fen` |
| **`engine-hub`** | `http://engine-hub:5000` | `http://127.0.0.1:5005` | Ходы ботов в PlayOut: `maia-1500` (Новичок), `maia-2200` (Профи), `mozero` (Мастер) |
| **`tableservice`** | `http://tableservice:5000` | `http://127.0.0.1:5006` | Эндшпильные таблицы Gaviota/Syzygy для позиций `<= 5` фигур |
| **WASM Stockfish** | В браузере клиента | В браузере | Локальный анализ позиции после решения или сдачи челленджа |

---

## 3. Схема Базы Данных `tele_app` (`PostgreSQL_Server`)

Схема `tele_app` создаётся как миграцией `PostgreSQL_Server/migrations/003_tele_app_and_drop_legacy_challenges.sql`, так и идемпотентным `bootstrapDatabase()` в `apps/backend/src/db/index.ts`. Также в `PostgreSQL_Server/Noco_connection_JSON/tele_app.json` находится готовый конфиг подключения для NocoDB.

### Таблицы схемы `tele_app`:
1. **`tele_app.users`** (`telegram_id text PRIMARY KEY`):
   - Поля: `username`, `first_name`, `last_name`, `avatar_url`, `language_code` (`'ru' | 'en' | 'de'`), `is_superadmin`, `created_at`, `updated_at`.
2. **`tele_app.clubs`** (`chat_id text PRIMARY KEY`):
   - Поля: `title`, `username`, `invite_link`, `owner_telegram_id`, `topic_thread_id`, `member_count`, `language`, `timezone`, `status` (`'active' | 'paused' | 'blocked' | 'bot_removed' | 'below_threshold'`), `blocked_reason`, `is_default`, `schedule_times` (`jsonb`, по умолчанию `["10:00", "18:00"]`), `leaderboard_cron_days` (`integer`, по умолчанию `7`), `filter_disciplines` (`jsonb`), `filter_difficulties` (`jsonb`), `filter_focus_group`, `filter_focus_keys` (`jsonb`), `filter_objective`, `last_published_at`, `last_leaderboard_at`, `terms_accepted_at`, `created_at`, `updated_at`.
3. **`tele_app.club_admins`** (`PRIMARY KEY (chat_id, telegram_id)`):
   - Права управления настройками клуба (`role`: `'owner' | 'admin'`).
4. **`tele_app.club_challenges`** (`id serial PRIMARY KEY`, `UNIQUE (chat_id, discipline, puzzle_id, edition)`):
   - Опубликованные в клубе челленджи (хранит `initial_fen`, `puzzle_fen`, `user_color`, `first_move`, `strategy`, `objective`, `tactical_solution`, `domain`, `category`, `tg_message_id`, `published_at`). Используется для исключения повторов задач в клубе и для отправки реплаев на `tg_message_id`.
5. **`tele_app.challenge_attempts`** (`id serial PRIMARY KEY`, `UNIQUE (chat_id, discipline, puzzle_id, edition, telegram_id)`):
   - Попытки игроков в разрезе конкретного чата (`chat_id`): `username`, `status` (`'in_progress' | 'solved' | 'surrendered'`), `solved`, `attempts`, `solved_time_ms`, `uci_moves`, `pgn_moves`, `notified_at`, `updated_at`, `completed_at`.
6. **`tele_app.promo_campaigns`** (`id serial PRIMARY KEY`):
   - Промо-кампании Суперадмина для рассылки по темам активных клубов.

---

## 4. Предрасчёт `PuzzleFen` и Взаимодействие с `puzzle_service`

- В пайплайн генерации датасетов `C:\MY_APPS\CHESS_APP\CREATOR\CreatePuzzleDataset\run.py` добавлен шаг 4 (`src/chess_creator/pipelines/puzzle_fen.py`), который заранее вычисляет колонку **`PuzzleFen`** (FEN позиции ровно в момент первого хода игрока) для всех 4 CSV-таблиц в `C:\MY_APPS\CHESS_APP\puzzle_service\PuzzleDatasetNEW\`:
  - `tactics_chess.csv` и `finishhim_chess.csv`: к `TacticalFEN` применяется первый ход из `TacticalSolution`.
  - `practical_chess.csv` и `theoretical_endgames.csv`: если `FirstMove == 'user'`, берётся `EndingFEN`; если `FirstMove == 'bot'`, применяется первый ход из `cache/leela_cache.json`.
- В `puzzle_service` (`CatalogSchemaVersion = 8`) поле `puzzle_fen` компилируется в SQLite-каталог и возвращается напрямую в эндпоинтах:
  - `GET /api/training/puzzle/{discipline}/{puzzle_id}`
  - `POST /api/training/puzzle/select`
- Бэкенд `EXTRAPAWN_MINI` (`puzzleClient.service.ts`) использует готовый `puzzle_fen` напрямую без вычислений на лету.

---

## 5. Воркфлоу Бота `@ExtraPawnTeleBot` и Система Начисления Очков

### 5.1. Настройки `@BotFather`
- `Allow Groups`: **On**
- `Group Privacy`: **On**
- `Group Admin Rights`: **`Manage Topics` (☑)** и **`Pin Messages` (☑)**
- Все специальные режимы (`Inline Mode`, `Threaded Mode` и др.): **Off**

### 5.2. Подключение клуба (`my_chat_member`)
- Владелец супергруппы ставит галочку согласия в `/cabinet` и нажимает «Добавить бота в супергруппу» (`https://t.me/ExtraPawnTeleBot?startgroup=true&admin=manage_topics+pin_messages`).
- Бот проверяет:
  1. Чат является `supergroup`.
  2. Число участников `>= 30` (кроме Суперадмина `5106981885` и дефолтного клуба).
  3. Пригласивший имеет статус `creator` или `administrator`.
  4. Создаёт тему `createForumTopic(chat_id, "ExtraPawnTeleBot")` (или использует `293770` для `EXTRAPAWNCLUB`).
- При успешной проверке регистрирует клуб в `tele_app.clubs` и сразу публикует приветствие и первый челлендж.

### 5.3. Публикация челленджа и Реплай при решении
1. При публикации челленджа (`publishChallengeToClub`) бот рендерит `board.png` (`600x600`), отправляет фото в тему клуба с кнопками `🔥 ЗАТАЩИТЬ` и `🏆 ТАБЛИЦА`, и **закрепляет сообщение** вызовом `pinChatMessage` (`disable_notification: true`).
2. При успешном решении задачи игроком бот отправляет текстовый ответ (`reply_parameters.message_id = tg_message_id`) в тему клуба:
   ```text
   @username 🤝
   Попыток - 1
   Секунд - 12.4
   ```
   с инлайн-кнопкой `ТАБЛИЦА`.
3. Раз в `leaderboard_cron_days` дней планировщик (`runScheduledClubsTick`) автоматически публикует в тему клуба сводку Топ-10 игроков (`publishClubLeaderboardToTopic`).

### 5.4. Формула начисления очков (`1 / attempts`)
Во всех таблицах рекордов используется единая функция `calculateAttemptPoints(solved, attempts)` из `packages/shared`:
- За решённую задачу начисляется **`1 / attempts`** очков:
  - с 1-й попытки = **`1.0`** очко
  - со 2-й попытки = **`0.5`** очка
  - с 3-й попытки = **`0.33`** очка (`1/3`)
  - с 4-й попытки = **`0.25`** очка (`1/4`) и т.д.
- За нерешённую задачу или сдачу (`surrendered`) = **`0`** очков.

---

## 6. Маршруты Фронтенда и Кодек `startapp`

### 6.1. Кодирование `tgWebAppStartParam` (`packages/shared/src/index.ts`)
- Вызов задачи: `c__<discCode>__<puzzleId>__<edition>__<encodedChatId>` -> `/challenge/:discipline/:puzzleId/:edition/:chatId`
- Рекорды задачи: `r__<discCode>__<puzzleId>__<edition>__<encodedChatId>` -> `/records/:discipline/:puzzleId/:edition/:chatId`
- Таблица клуба: `l__<encodedChatId>` -> `/challenge/records/:chatId`
*(Отрицательный `chat_id` вида `-1002255301933` кодируется как `n1002255301933` для соблюдения ограничений Telegram `startapp`).*

### 6.2. Экраны приложения
| Маршрут | Компонент | Описание |
| :--- | :--- | :--- |
| `/cabinet` | `UserCabinetPage.vue` | Личный кабинет: статистика игрока по 4 дисциплинам (Попыток / Успехов / Провалов / Очков), список клубов и подключение своей супергруппы. |
| `/clubs` | `ClubsLeaderboardPage.vue` | **Соревнование клубов за 30 дней:** таблица всех активных клубов с очками по 4 дисциплинам (`Тактика / Теория / Практика / Добивание`) и **средним арифметическим** (`(T + E + P + F) / 4`). |
| `/challenge/:discipline/:puzzleId/:edition/:chatId/:userId?` | `ChallengePlayPage.vue` | Решение челленджа на доске `Chessground`, спарринг с ботом (`Maia 1500/2200`, `MOZERO`), локальный анализ Stockfish 19 WASM и просмотр партий других решивших участников. |
| `/records/:discipline/:puzzleId/:edition/:chatId/:userId?` | `TaskRecordsPage.vue` | Таблица участников конкретного челленджа с переходом к просмотру их ходов. |
| `/challenge/records/:chatId` | `ClubRecordsPage.vue` | Общий рейтинг игроков клуба по всем 4 дисциплинам + список последних опубликованных челленджей клуба. |
| `/club-settings/:chatId` | `ClubSettingsPage.vue` | Настройки бота для владельца/админа клуба (плитки как в WarmUp: дисциплины, сложность, фокус, расписание, язык). |
| `/super-admin` | `SuperAdminPage.vue` | Панель Суперадмина (`5106981885`): статистика платформы, блокировка/разблокировка групп, промо-рассылки. |
