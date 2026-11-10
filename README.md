# ExtraPawn Telegram Mini App (`mini.extrapawn.com`)

Standalone viral Telegram Mini App & Bot ecosystem (`@ExtraPawnTeleBot`) for multi-club chess challenges (`Tactics`, `Theoretical Endgames`, `Practical Endgames`, `Finish Him`).

## Architecture (`pnpm` + `Turborepo`)

- **`packages/shared`**: Shared TypeScript domain contracts, WarmUp focus tile definitions, and Telegram `startapp` deep-link encoder/decoder.
- **`apps/backend`**: Fastify + Drizzle ORM (`tele_app` schema in PostgreSQL) + `@resvg/resvg-js` (`board.png` renderer) + `chessops` (`puzzle_fen` calculator) + Telegram Bot API controller & cron scheduler + proxies to `puzzle_service`, `engine-hub` (`Maia 1500`, `Maia 2200`, `MOZERO`), and `tableservice` (Gaviota `<= 5` pieces).
- **`apps/frontend`**: Vue 3 + Vite + Tailwind CSS v4 + `@lichess-org/chessground` + `chessops` + local browser WASM Stockfish 19 (`stockfish-19-single.js`) following Feature-Sliced Design (FSD).

## Development & Validation

```bash
pnpm install
pnpm type-check
pnpm lint
pnpm build
```

## License

GNU General Public License v3.0 — see [LICENSE](./LICENSE).

