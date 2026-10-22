# Sleepy Coder — notes for Claude

The full project brief is in `docs/brief.md`. Read it before making changes.
Architectural decisions are recorded in `docs/decisions.md`.

## Current status

- Phase 1 (Foundation): done. pnpm monorepo, Fastify `/health`, Astro + React dashboard, Vitest.
- Phase 2 (Ollama): done. `packages/ollama` client, `GET /ollama/status`, `POST /ollama/test`,
  Ollama card on the dashboard.
- Phase 3 (Repository Scout): done. `packages/analyzer` (file scan, languages, stack detection),
  `packages/git` (read-only inspection with simple-git), `/repositories` routes, Repositories page.
  Saved repositories live in `data/repositories.json`.
- Next up: Phase 4 (Task Hunter). The report `warnings` are its starting point.

Local model on the dev machine: `gemma3:4b` (the user prefers Gemma).

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `SLEEPY_OLLAMA_URL` | `http://127.0.0.1:11434` | Where Ollama listens |
| `SLEEPY_MODEL` | first installed Gemma model | Force a specific model |
| `SLEEPY_DATA_DIR` | `<repo root>/data` | Local data folder |

## Conventions

- TypeScript everywhere. Code and identifiers in English; user-facing UI text in Spanish.
- Plain CSS: theme tokens in `apps/web/src/styles/global.css`, scoped `<style>` in Astro,
  CSS Modules in React Islands. No CSS frameworks.
- Backend listens only on `127.0.0.1`. Never expose it publicly.
- POST/DELETE routes require the `x-sleepy-client: web` header (`src/security.ts`).
  In server tests use `clientHeaders` from `test/client-headers.ts`.
- Adding a repository: "Elegir carpeta…" opens the native dialog through `POST /system/pick-folder`.
- No schedulers, cron jobs or daemons: execution is always started by the user.
- New packages go in `packages/<name>` with the `@sleepy-coder/<name>` scope.
  Create a package only when a phase actually needs it.
- Shared packages export TypeScript source directly (`"exports": "./src/index.ts"`).
- Run `pnpm test` and `pnpm typecheck` before saying something works.

## Commands

```bash
pnpm install        # install all workspaces
pnpm dev            # backend (4317) + frontend (4321) together
pnpm test           # Vitest in every workspace
pnpm typecheck      # tsc / astro check in every workspace
```