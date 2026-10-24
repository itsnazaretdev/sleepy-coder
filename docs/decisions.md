# Architecture decisions

Short records of the important choices and why they were made.

## ADR-001 — Astro and Fastify as separate apps

**Decision:** The frontend (`apps/web`, Astro) and the backend (`apps/server`, Fastify)
are independent applications. Astro API routes are not used.

**Why:** The backend needs long-running work (agent sessions), filesystem and Git access,
Ollama calls and SSE streaming. Keeping it separate makes those responsibilities clear and
lets the frontend stay a static site.

## ADR-002 — Static Astro output (SSG) + React Islands

**Decision:** Astro builds static pages. Dynamic data is fetched by React Islands from the
backend over HTTP; live progress will use SSE.

**Why:** SSR would add a second server with no real benefit, since all logic and data live
in Fastify.

## ADR-003 — Loopback-only backend with strict CORS

**Decision:** The backend binds to `127.0.0.1:4317`. CORS only allows the local Astro origins
(`localhost:4321` and `127.0.0.1:4321`).

**Why:** Sleepy Coder will be able to read repositories and run commands. It must never be
reachable from the network, and random websites open in the browser must not be able to call it.

## ADR-004 — Plain CSS with custom properties

**Decision:** No CSS framework. Theme tokens are CSS custom properties on `:root`.

**Why:** Easier to read and learn from at this stage. Tokens keep the dark/violet theme in
one place, and a later move to a framework stays simple.

## ADR-005 — Shared packages export TypeScript source

**Decision:** Workspace packages (e.g. `@sleepy-coder/shared`) export `src/index.ts`
directly instead of a compiled `dist`.

**Why:** No build step between packages. Both `tsx` (server) and Vite (web) compile TS
on the fly. The server therefore runs with `tsx` instead of plain `node`.

## ADR-006 — On-demand execution only

**Decision:** No schedulers, cron jobs or background daemons. Work Sessions are always
started by the user and only run while the backend is running.

**Why:** Keeps the user in control and avoids needing an always-on machine.
See "Execution Philosophy" in `docs/brief.md`.

## ADR-007 — Own Ollama client on native fetch

**Decision:** `packages/ollama` talks to the Ollama REST API with the built-in `fetch`
instead of the `ollama` npm library. It exposes a small `OllamaClient` interface
(`getVersion`, `listModels`, `chat`) and typed errors (`unreachable`, `timeout`,
`model-not-found`, `bad-response`).

**Why:** We only need three endpoints. Owning the client means no extra dependency, explicit
timeouts (the first prompt loads the model and can be slow on a laptop), and an interface
that is trivial to fake in tests. Swapping the provider later only means implementing the
same interface.

## ADR-008 — Model selection

**Decision:** If `SLEEPY_MODEL` is set, that model is used (and flagged if not installed).
Otherwise the first installed Gemma model is used, then any installed model.

**Why:** Works out of the box with the existing Gemma install, while letting the user switch
(e.g. to `qwen2.5:3b`) without touching code.

## ADR-009 — "Ollama off" is a normal state

**Decision:** `GET /ollama/status` always returns 200 with `running: true | false`.
Only real request failures (e.g. `POST /ollama/test`) map to 4xx/5xx codes.

**Why:** The backend itself is healthy when Ollama is closed; the UI just needs to show it
and explain how to start it.

## ADR-010 — Saved repositories in a JSON file (superseded by ADR-015)

**Decision:** The list of repositories is stored in `data/repositories.json` behind a
`RepositoryStore` interface. Writes are serialized and atomic (temp file + rename).

**Why:** Phase 3 only needs a short list. SQLite (planned in the stack) will arrive with
Phase 4, when tasks and history need real queries; only the store implementation changes.

## ADR-011 — Repository paths are validated and analysis is read-only

**Decision:** A path is accepted only if it is absolute (`~` is expanded), exists, is a
folder and is the root of a Git repository. It is stored resolved with `realpath`, so the
same folder reached through a symlink or a trailing slash is detected as a duplicate.
The id is a hash of that path. The scanner skips symlinks and generated folders and stops
at 20,000 files. Git is only inspected with fixed, read-only commands.

**Why:** These checks are the base for the safety rules of later phases (the agent must
never leave the repository). Analysis must never change anything on disk.

## ADR-012 — Own stack detection instead of Tree-sitter (for now)

**Decision:** Phase 3 detects languages by extension and the stack from manifests
(`package.json`, `composer.json`, `pom.xml`, …) and lockfiles.

**Why:** It is fast, has no dependencies and is enough for a structural overview.

## ADR-013 — Native folder dialog opened by the backend

**Decision:** `POST /system/pick-folder` makes the backend open the OS dialog
(`osascript` "choose folder" on macOS, `zenity` on Linux) and return the chosen path.
Typing the path stays available as a fallback. Commands and arguments are fixed; only
one dialog can be open at a time; it gives up after 5 minutes.

**Why:** Browsers never expose a folder's real path to a web page (not with drag & drop,
not with `<input type="file">`). Since the backend runs on the user's machine, it can show
the native dialog instead, which is much easier than copying paths.

## ADR-014 — Protection against other websites and DNS rebinding

**Decision:** Every request must be addressed to `localhost`, `127.0.0.1` or `[::1]`.
Every POST/DELETE must carry the `x-sleepy-client: web` header.

**Why:** CORS only stops other sites from *reading* responses; a simple POST is still
*sent*. A custom header forces a CORS preflight, which is rejected for any origin other
than our web app. The Host check blocks DNS rebinding. This matters before the agent is
able to modify code (Phase 5).

## ADR-015 — SQLite with Node's built-in `node:sqlite`

**Decision:** Local data lives in `data/sleepy-coder.db`, opened with `node:sqlite`
(Node 22.13+). The schema is versioned with `PRAGMA user_version`; new changes are added as
new migrations, never by editing old ones. Foreign keys are on, so deleting a repository
deletes its tasks. On first start, Phase 3's `repositories.json` is imported once and
renamed to `repositories.json.imported`. Tests use an in-memory database.

**Why:** No native dependency to compile (unlike `better-sqlite3`), and it is enough for a
local, single-user app. Node prints an "experimental" warning for now; the API is stable
enough for our simple queries.

## ADR-016 — Static task hunting and task fingerprints

**Decision:** Phase 4a finds tasks without AI: report gaps (no tests, README, LICENSE) and
`TODO`/`FIXME`/`HACK`/`XXX` comments. Markers count only in UPPERCASE (in Spanish "todo" is a
normal word), only inside comments and not inside strings. Each task has a fingerprint
(e.g. file + marker + text, not the line number), stored hashed. On each hunt, new
fingerprints are added as pending, existing ones keep their status, and pending tasks that
no longer appear are removed. Approved and discarded tasks are never touched by a hunt.

**Why:** Re-running a hunt must be safe and predictable: no duplicates, and a human decision
(approve/discard) is never undone automatically. AI suggestions (Phase 4b) will use the same
mechanism with `source = 'ai'`.

## ADR-017 — AI task suggestions: small context, strict schema, distrust the output

**Decision:** `POST /repositories/:id/tasks/suggest` sends the local model a summary of the
repository, a list of source files and excerpts of the biggest non-test source files, with a
hard budget (~12,000 characters of code, ≈5k tokens in total) and `num_ctx = 8192`. The answer is
constrained with Ollama structured outputs (a JSON Schema), and then validated again:
invalid tasks are skipped, unknown enum values get safe defaults, files that do not exist are
removed, repeated or already known titles are dropped and at most 5 tasks are kept.
The prompt lists existing tasks so the model does not repeat them. Only one suggestion runs
at a time. The `tasks` package talks to a provider-agnostic `TaskModel`; the server adapts Ollama.

The model answers in English and wraps code names in backticks, which the UI renders as code.

## ADR-018 — The agent works in a git worktree on its own branch

**Decision:** Each task runs in a `git worktree` under `data/worktrees/`, on a new branch named
`sleepy/<title-slug>-<task-id>` that starts at the user's current HEAD. The agent commits only
there (it refuses any branch without the `sleepy/` prefix), signs commits as "Sleepy Coder",
skips repository hooks (`--no-verify`) and never commits `node_modules`. Removing a worktree
keeps its branch so the result can still be reviewed. Nothing is ever merged or pushed.

**Why:** The user's folder, current branch and uncommitted changes stay untouched no matter
what the agent does, and every change is one normal Git branch away from review or deletion.

## ADR-019 — Sandboxed file access and a fixed test command

**Decision:** The agent's only access to files is `openWorkspace()`:
- paths must be relative; `..`, absolute paths, `~` and control characters are rejected;
- after resolving symlinks, every path must stay inside the worktree;
- `.git` and `node_modules` can be neither read nor written;
- files that decide what gets executed are read-only: `package.json`, lockfiles, `.npmrc`,
  `.env*`, CI/hook folders and tool configs (`*.config.{js,ts,mjs…}`, `.eslintrc.cjs`…);
- size limits for reads and writes; text only.

The only command the agent can trigger is the repository's own `test` script, read from the
user's original checkout, run with the lockfile's package manager, without a shell, with
`CI=1`, a timeout that kills the whole process group, and limited output. The worktree reuses
the user's `node_modules` through symlinks instead of reinstalling.

**Why:** Paths from the model are untrusted input. Locking the files that define scripts,
dependencies and configs means the model cannot choose which commands run.

**Known residual risk:** running tests executes code, including tests or source files the agent
wrote. This cannot be fully prevented while the agent is allowed to run tests; it is accepted
because a task only runs after the user explicitly approves it, on their own repository.

## ADR-020 — A guided agent pipeline instead of a free tool loop

**Decision:** Running a task is a fixed pipeline, not an open-ended "the model picks a tool"
loop: create worktree → run tests before → give the model the task and the relevant files
(at most ~24k characters; files over 12k characters are not rewritten) → the model returns a
summary and search/replace blocks for at most 3 files (JSON Schema; an empty `search` creates a
new file; the search text must appear exactly once, ignoring indentation if needed; a file is
written only if all its blocks apply) → each edit is checked
(sandboxed path, protected files, no placeholders like `// ... rest of the code`, does not delete
more than half of a file) → run tests → if the change broke tests that passed before, one fix
attempt with the test output → commit on the agent branch → save the diff → remove the worktree
folder. Without a commit, the empty branch is deleted.

The run happens in the background inside the backend (`POST /tasks/:id/run` answers 202);
the UI polls `GET /runs/:id` every 2 s until Work Sessions bring SSE. One run at a time.
At startup, runs left `running` become `interrupted` and their worktree folders are removed.

**Why:** A 4B model is unreliable at multi-step tool use. The first version asked it for the
complete new content of each file; in real runs Gemma dropped half of a component while changing
one line. Search/replace blocks ("replace this exact snippet with this one") keep the rest of the
file byte-for-byte identical, so the model only has to get the changed part right.

## ADR-022 — "Done" must mean the task is done

**Decision:** Two extra checks before the agent commits:
- An edit that only changes whitespace (spaces, line breaks) is rejected. The prompt also tells
  the model not to reformat code it is not changing, and to return no change (with an
  explanation) if the task does not apply to the files it sees.
- For tasks found by rules (`source: 'static'`), the same rules are run again on the worktree
  after the change. If they still produce the task, the model gets one more try with that
  problem in front of it; if it is still there, the run fails and nothing is committed.

**Why:** In a real run on the CSS backgrounds project, Gemma was asked to add `alt` text and
only reformatted a file; the run was reported as "Done". Re-using the rule that found a task
as its acceptance check makes "Done" trustworthy for those tasks. AI-suggested tasks have no
such rule, so for them the whitespace check is the safety net and the diff review matters more.

## ADR-021 — SEO and accessibility checks are rules, not AI

**Decision:** "Find tasks" also checks markup files (`.astro`, `.html`, `.jsx`, `.tsx`, `.vue`,
`.svelte`) for: more than one `<h1>` per page, `<img>` without `alt`, and `<html>` without `lang`.
Astro pages are checked as rendered: imports of `.astro` components are followed (relative,
`@/…` and `~/…`), so an `<h1>` in the layout plus one in the page is found.

For duplicate `<h1>`, the rule decides which one is the real main title and keeps it out of the
task: the page's own `<h1>` if it has one, otherwise a hero/header-like component, otherwise
the only file that does not look like a preview, modal, card or mockup. The task's affected
files are only the files to change, its instructions name the `<h1>` to keep, and pages broken
by the same extra `<h1>` become one task. When the main title is unclear, the task asks the
user to decide. (Found on the CSS backgrounds site: a preview modal simulating a website had its
own `<h1>`, and the first version of the rule blamed the hero.)

Later additions (same approach, ADR-023 made rules the reliable core): pages without `<title>`
or `<meta name="description">` (checked across the rendered page, reported in the file that has
the `<head>`, so pages sharing a layout become one task), links without readable text,
`target="_blank"` without `rel="noopener"`, and leftover `console.log` in front-end files under
`src/` (server, API, scripts, tests and config files are skipped: logging there is often intended).

**Why:** These issues are common, easy to verify with rules and often span two files (layout
and page), which the AI never sees together because it only reads a few files. A rule always
finds them, and it hands the agent exactly the files it needs. A fixed pipeline keeps every step predictable and testable, and the checks catch the most
common small-model failures (truncated files, placeholders) before anything is committed.

**Why:** A 4B model on a laptop has a small context window and sometimes invents files or
fields. Keeping the input small makes it faster and more focused; treating the output as
untrusted keeps bad suggestions out of the database. Pending AI tasks are replaced on each run
(their titles change from run to run), while approved and discarded ones are kept.
Tree-sitter is kept for Phase 4/5, where real code parsing (functions, TODOs in context)
is needed.

## ADR-023 — Fix guides instead of automatic edits; the agent becomes experimental

**Context:** With `gemma3:4b`, the agent (ADR-018 to ADR-022) failed on most real tasks, each time
in a new way: it reformatted instead of fixing (whole-file edits), deleted more than half of a
file, and with search/replace blocks it wrote the text to replace from memory, so it was not in
the file ("the text to replace was not found"). The safety checks always caught it — nothing
bad was committed — but a run that ends in "Failed" most of the time does not help anyone, and
bigger tasks than a duplicate `<h1>` would fail more, not less. The model's explanations, on the
other hand, were consistently right.

**Decision:** The default flow is a fix guide, and the user makes the change:
- **Where** (`locateTask`, no AI): the file, line and a snippet for each problem. Rules know what
  they look for (`<h1>` outside comments, `<img>` without `alt`, the TODO line even if it moved),
  so these locations are exact. For AI tasks, the code names in backticks are searched in the
  affected files.
- **How** (`writeFixGuide`, on request): the model sees the numbered lines and the task's hint
  and returns an explanation, steps and suggested code. It is validated like any model output
  (lengths capped, suggestions only for the task's files) and saved in `task_guides`
  (migration 3, the latest per task). Nothing is written to the repository.
- **Check again** (`POST /tasks/:id/check`): for static tasks, the rules run again on the
  repository; if the task's fingerprint is gone, the status becomes `done`. AI tasks are marked
  as done by the user. A static task marked `done` that a later hunt finds again goes back to
  `pending`.
- AI-suggested tasks can be wrong (in the CSS backgrounds project, Gemma said every SEO
  description was an empty string; none was). When no exact line is found, the guide prompt
  includes the file itself, and the model must first answer `applies`: if the problem is not in
  the code, the UI says so and offers to discard the task (migration 4 adds `applies`).
- The agent is kept, off by default: `SLEEPY_EXPERIMENTAL_AGENT=1` shows the Run button and
  enables `POST /tasks/:id/run` (otherwise it answers 403 `agent-disabled`).

**Why:** It plays to what each part does reliably: rules are exact, the model is good at
explaining, the person is good at editing. It keeps the human in control (the brief's Assistant
mode) and turns Sleepy Coder into a fast "where is the problem and why" tool. The agent code is
tested and safe, costs nothing when off, and is ready for larger local models.