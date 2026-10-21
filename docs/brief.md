# 💤 Sleepy Coder — Project Brief

## 1. Project Overview

**Name:** Sleepy Coder

**Tagline:** Your AI developer that handles the boring stuff.

**Concept:** Sleepy Coder is a local-first AI coding assistant that analyzes software repositories, identifies opportunities for improvement, and performs approved development tasks on demand.

The goal is to build a tool that developers can run entirely on their own computers, using open-weight AI models through Ollama, without relying on cloud infrastructure or paid AI APIs.

The main idea:

> Instead of spending more time interacting with AI, let AI work quietly in the background on approved tasks while you focus on something else — whenever you decide to start it.

This project is being developed for a Hacktoberfest challenge themed **Slow and Steady**, focused on open-source AI that rewards laziness.

## 2. Execution Philosophy — On-Demand AI

Sleepy Coder does not require overnight execution, scheduled jobs or an always-on computer.

The application is designed around on-demand AI-assisted development. Users start an analysis or execution session whenever they need it. The agent performs approved tasks while the application and local backend are running.

Core principles:

- No overnight execution requirement.
- No scheduled execution requirement.
- No always-on infrastructure.
- Users control when tasks start and stop.
- Tasks can be executed individually or in batches.
- Progress is visible in real time.
- Sessions can be cancelled.
- Results and execution history are stored locally.

### Workflow

1. Select a local repository.
2. Analyze its structure and code.
3. Discover potential improvements.
4. Review and approve tasks.
5. Start an on-demand execution session.
6. Let the agent work with configurable autonomy.
7. Review generated changes, Git diffs and test results.
8. Accept, modify or discard changes.

### Terminology

| Term | Meaning |
|---|---|
| Work Session | A user-started run that executes one or more approved tasks |
| On-Demand Execution | Execution that only happens when the user starts it |
| Task Report | Summary of what a Work Session did |
| Approved Tasks | Tasks the user has reviewed and allowed the agent to execute |

## 3. Main Objectives

Sleepy Coder should:

- Analyze local Git repositories.
- Understand repository structure and source code.
- Identify potential improvements and technical debt.
- Detect TODOs, FIXMEs, missing tests and outdated documentation.
- Generate actionable development tasks.
- Execute approved tasks using an AI agent, on demand.
- Create isolated Git branches for modifications.
- Run tests and validate generated changes.
- Produce a Task Report explaining what was done.
- Keep all code and project data locally.

## 4. Technology Stack

The selected stack is TypeScript-first.

| Component | Technology |
|---|---|
| Frontend | Astro |
| Interactive UI | React Islands |
| Language | TypeScript |
| Backend | Node.js + Fastify |
| AI runtime | Ollama |
| Initial AI model | Existing Gemma installation |
| Git integration | simple-git |
| Code analysis | Tree-sitter |
| Database | SQLite |
| Styling | Plain CSS (custom properties for theme tokens) |
| Testing | Vitest |

### Important architectural decision

Use Astro and Fastify as separate applications.

Do not build the backend inside Astro API routes.

The frontend communicates with the backend through HTTP and Server-Sent Events (SSE). SSE is used to stream Work Session progress in real time.

The backend manages the agent, Git operations, repository analysis, Ollama integration and database.

## 5. Local-First Requirements

This is one of the most important aspects of the project.

Sleepy Coder must:

- Run entirely on the user's MacBook.
- Use Ollama for local inference.
- Avoid mandatory external APIs.
- Avoid cloud databases and hosted backend services.
- Work offline after initial installation and model download.
- Store configuration, history and task information locally.
- Allow models to be changed without modifying the agent implementation.

Development hardware:

- MacBook Pro M1.
- 16 GB RAM.
- Ollama already installed.
- Gemma already downloaded (exact model/version needs verification using `ollama list`).

Do not download additional models until checking the existing Ollama installation and available memory.

## 6. Agent Autonomy and Safety

The preferred approach is semi-autonomous, with configurable execution permissions. All execution happens inside user-started sessions.

Three execution modes are planned:

### Observer Mode
- Analyze repositories.
- Identify problems.
- Suggest tasks.
- Never modify source files.

### Assistant Mode (default)
- Execute individually approved tasks.
- Modify files.
- Create isolated Git branches.
- Run tests.
- Present changes for human review.

### Work Session Mode
- Execute a batch of approved tasks, started by the user.
- Operate within configurable limits (max tasks, time per task, total session time).
- Stream progress in real time.
- Can be cancelled at any moment; cancellation stops after the current safe step and leaves branches intact.
- Run tests and validations.
- Produce a Task Report when the session ends.

### Interrupted sessions

Sessions only run while the app and local backend are running. If the backend stops mid-session, tasks in progress are marked as `interrupted` on next startup, their branches are left untouched, and nothing resumes automatically.

### Mandatory safety rules

- Never automatically merge changes.
- Never push to remote repositories without explicit approval.
- Never modify the main branch.
- Use isolated branches or worktrees.
- Restrict shell commands to an explicit allowlist.
- Never allow unrestricted shell execution by the LLM.
- Validate paths and prevent directory traversal.
- Set execution timeouts and resource limits.
- Require human approval for sensitive operations.
- Stop and report failures instead of silently continuing.

The agent must not have unrestricted access to the host machine.

## 7. Project Architecture

Proposed monorepo structure:

```text
sleepy-coder/
│
├── apps/
│   ├── web/                 # Astro + React
│   └── server/              # Fastify API
│
├── packages/
│   ├── agent/               # Agent orchestration
│   ├── ollama/              # Ollama integration
│   ├── git/                 # Git operations
│   ├── analyzer/            # Repository analysis
│   ├── tasks/               # Task management
│   └── shared/              # Shared TypeScript types
│
├── data/                    # Local SQLite database
├── docs/
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

Use pnpm workspaces.

Each package should have clear responsibilities and minimal coupling.

## 8. Main Features

### Feature 1: Repository Scout

Analyze a selected local repository.

Responsibilities:
- Read directory structure.
- Identify programming languages.
- Detect package managers and project configuration.
- Identify frameworks and testing tools.
- Exclude generated directories such as node_modules, dist, build and .git.
- Generate a structured repository overview.

### Feature 2: Task Hunter

Identify opportunities for improvements.

Examples:
- TODO/FIXME comments.
- Missing unit tests.
- Functions without adequate test coverage.
- Documentation gaps.
- Deprecated APIs.
- Duplicated code.
- Simple refactoring opportunities.

The LLM should return structured tasks with:
- Title.
- Description.
- Category.
- Priority.
- Affected files.
- Estimated complexity.
- Suggested implementation.
- Risk level.

### Feature 3: Agent Engine

An agent capable of executing approved tasks.

It should:
- Receive a structured task.
- Inspect relevant files.
- Plan modifications.
- Generate code changes.
- Apply modifications in an isolated workspace.
- Run validation and tests.
- Report results.

Keep the orchestration modular and independent of any specific LLM provider.

### Feature 4: Git Manager

Use simple-git to:
- Inspect repositories.
- Create branches.
- Check working tree status.
- Create isolated workspaces.
- Review diffs.
- Track changes.

Never overwrite pre-existing user changes.

### Feature 5: Task Report

Generated at the end of each Work Session (or single task execution). Present:
- Completed tasks.
- Failed, cancelled or interrupted tasks.
- Modified files.
- Git diff summaries.
- Tests executed.
- Test results.
- Warnings.
- Suggested next steps.

From the report, the user can accept, modify or discard each change.

## 9. User Interface

The application should have a modern, polished developer-tool interface.

Visual direction:
- Dark theme.
- Purple/violet accent colors.
- Clean dashboard.
- Minimal and professional.
- Subtle sloth branding and personality.
- Avoid an overly cartoonish interface.

Styling approach:
- Plain CSS, no CSS framework.
- Colors, spacing, radii and fonts defined as CSS custom properties on `:root` (e.g. `--color-bg`, `--color-accent`) so the dark/violet theme lives in one place.
- Global styles in a single stylesheet; component-specific styles scoped with Astro's `<style>` blocks or CSS Modules in React Islands.

Main screens:

1. Dashboard.
2. Repositories.
3. Repository Analysis.
4. Task Queue.
5. Work Session (live execution).
6. Execution History.
7. Task Reports.
8. Settings.

The dashboard should show:
- Connected repositories.
- Approved / pending tasks.
- Completed tasks.
- Agent status (idle, running, cancelling).
- Recent Work Sessions.
- Ollama connection status.
- Active execution mode.
- A clear "Start Work Session" action.

React Islands should be used for genuinely interactive UI components (live session progress, task approval, diff viewer) rather than making the entire application a React SPA.

## 10. Development Roadmap

Build incrementally. Do not attempt to implement every feature at once.

### Phase 1 — Foundation
- Initialize pnpm monorepo.
- Configure Astro frontend.
- Configure Fastify backend.
- Configure TypeScript.
- Establish shared package conventions.
- Add Vitest.
- Implement health endpoint.

### Phase 2 — Ollama Integration
- Detect whether Ollama is running.
- Retrieve installed models.
- Verify Gemma availability.
- Implement chat/completion integration.
- Add error handling and timeouts.
- Implement model configuration.

### Phase 3 — Repository Scout
- Local repository selection.
- Filesystem scanning.
- Git status inspection.
- Language and framework detection.
- Structured repository report.

### Phase 4 — Task Hunter
- Static analysis.
- TODO/FIXME detection.
- LLM-assisted task discovery.
- Structured task persistence.
- Task approval interface.

### Phase 5 — Agent Engine
- Task planning.
- Tool execution.
- File modification.
- Isolated Git branches/worktrees.
- Test execution.
- Permission and safety controls.

### Phase 6 — Work Sessions
- User-started execution of approved tasks.
- Single-task and batch execution.
- Configurable session limits.
- Real-time progress via SSE.
- Cancellation.
- Handling of interrupted sessions on restart.

### Phase 7 — Task Reports
- Execution summaries.
- Diff visualization.
- Test results.
- Human review workflow (accept, modify, discard).

## 11. Immediate Next Steps

The project is currently at the beginning of Phase 1.

The initial implementation plan is:

1. Inspect the existing development environment.
2. Check Node.js, pnpm and Ollama versions.
3. Run `ollama list` to identify the installed Gemma model.
4. Initialize the monorepo.
5. Create the Astro application.
6. Add React integration.
7. Configure the Fastify backend.
8. Implement `/health`.
9. Verify both applications run locally.
10. Start implementing the `packages/ollama` integration.

The initial backend should listen only on `127.0.0.1`.

Do not expose the service publicly.

## 12. Development Guidelines for Claude

Act as the senior software engineer responsible for implementing Sleepy Coder.

Important instructions:

- Follow the agreed architecture.
- Use TypeScript throughout.
- Prefer small, maintainable modules.
- Avoid unnecessary abstractions and overengineering.
- Do not introduce Python.
- Do not add cloud dependencies.
- Do not introduce paid API requirements.
- Do not add schedulers, cron jobs or background daemons: execution is always user-started.
- Do not assume the Ollama model version; inspect the actual installation.
- Write tests for important business logic.
- Document architectural decisions.
- Keep security and local execution boundaries in mind.
- Do not implement the entire roadmap in one step.
- Explain important architectural choices before introducing major dependencies.
- Verify commands and tests before claiming that something works.

**First task:** Inspect the existing project directory and development environment. Then help initialize Phase 1, implementing the monorepo and verifying that Astro and Fastify work correctly.

Do not skip directly to agent implementation.

---

## Project philosophy

Sleepy Coder is not an AI agent that needs to work while developers sleep. It is an AI coding assistant that eliminates repetitive development work whenever developers choose to use it.

It embodies three principles:

1. **Slow and Steady:** Work quietly and systematically.
2. **Local First:** Your code, your data, your machine.
3. **Human in Control:** AI does the repetitive work, developers make the important decisions — including when it runs.

**Sleepy Coder — Let your code sleep. We'll handle the boring stuff.**
