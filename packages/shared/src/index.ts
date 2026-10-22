/**
 * Shared types and constants used by both the server and the web app.
 * Keep this package free of runtime dependencies.
 */

/** Backend only listens on loopback: never exposed to the network. */
export const SERVER_HOST = '127.0.0.1';
export const SERVER_PORT = 4317;
export const SERVER_URL = `http://${SERVER_HOST}:${SERVER_PORT}`;

/** Astro dev server origin, allowed by the backend CORS policy. */
export const WEB_PORT = 4321;
export const WEB_ORIGINS = [
  `http://localhost:${WEB_PORT}`,
  `http://127.0.0.1:${WEB_PORT}`,
];

export interface HealthResponse {
  status: 'ok';
  service: 'sleepy-coder-server';
  version: string;
  /** Seconds since the server process started. */
  uptime: number;
  /** ISO 8601 timestamp of the response. */
  timestamp: string;
}

// --- Ollama -----------------------------------------------------------------

export interface OllamaModelInfo {
  name: string;
  sizeBytes: number;
  family: string | null;
  parameterSize: string | null;
  quantization: string | null;
  modifiedAt: string;
}

export type OllamaErrorCode = 'unreachable' | 'timeout' | 'model-not-found' | 'bad-response';

export type OllamaStatusResponse =
  | {
      running: true;
      url: string;
      version: string;
      models: OllamaModelInfo[];
      /** Model Sleepy Coder will use, or null if none is installed. */
      selectedModel: string | null;
      selectedModelAvailable: boolean;
      /** "configured" = set via SLEEPY_MODEL, "auto" = picked automatically. */
      selectionSource: 'configured' | 'auto' | 'none';
    }
  | {
      running: false;
      url: string;
      errorCode: OllamaErrorCode;
      message: string;
    };

export interface OllamaTestResponse {
  model: string;
  reply: string;
  durationMs: number | null;
}

/** Error body returned by the API for failed requests. */
export interface ApiError {
  error: string;
  message: string;
}

// --- Repositories -----------------------------------------------------------

export interface Repository {
  /** Stable id derived from the absolute path. */
  id: string;
  /** Folder name, e.g. "sleepy-coder". */
  name: string;
  /** Absolute, resolved path on disk. */
  path: string;
  /** ISO 8601 timestamp. */
  addedAt: string;
}

export interface LanguageStat {
  language: string;
  files: number;
  bytes: number;
  /** Share of code bytes, 0–100, one decimal. */
  percent: number;
}

/** Result of scanning the files of a repository (no Git information). */
export interface StructureReport {
  files: {
    total: number;
    totalBytes: number;
    testFiles: number;
    /** True if the scan stopped early because the repo is very large. */
    truncated: boolean;
  };
  languages: LanguageStat[];
  packageManagers: string[];
  frameworks: string[];
  testingTools: string[];
  configFiles: string[];
  hasReadme: boolean;
  hasLicense: boolean;
}

export interface GitCommitInfo {
  hash: string;
  message: string;
  author: string;
  /** ISO 8601 timestamp. */
  date: string;
}

export interface GitInfo {
  /** Current branch, or null when HEAD is detached. */
  branch: string | null;
  /** Upstream branch, e.g. "origin/main". */
  tracking: string | null;
  ahead: number;
  behind: number;
  isClean: boolean;
  /** Tracked files with changes (staged or not). */
  changedFiles: number;
  untrackedFiles: number;
  /** Null for a repository without commits. */
  lastCommit: GitCommitInfo | null;
  remotes: string[];
}

export type ReportWarningCode =
  | 'no-readme'
  | 'no-license'
  | 'no-tests'
  | 'uncommitted-changes'
  | 'scan-truncated';

export interface RepositoryReport extends StructureReport {
  repository: Repository;
  git: GitInfo;
  warnings: ReportWarningCode[];
  /** ISO 8601 timestamp. */
  analyzedAt: string;
  durationMs: number;
}

export interface AddRepositoryRequest {
  path: string;
}

// --- Tasks ------------------------------------------------------------------

export type TaskCategory = 'todo' | 'tests' | 'documentation' | 'refactor' | 'maintenance';
export type TaskLevel = 'low' | 'medium' | 'high';
export type TaskComplexity = 'small' | 'medium' | 'large';
export type TaskStatus = 'pending' | 'approved' | 'discarded';
/** "static" = found by rules (no AI), "ai" = suggested by the local model. */
export type TaskSource = 'static' | 'ai';

/** A task as produced by a hunter, before it is saved. */
export interface TaskDraft {
  /** Stable key used to recognise the same task on the next hunt. */
  fingerprint: string;
  source: TaskSource;
  title: string;
  description: string;
  category: TaskCategory;
  priority: TaskLevel;
  complexity: TaskComplexity;
  risk: TaskLevel;
  affectedFiles: string[];
  suggestedImplementation: string;
}

export interface Task extends TaskDraft {
  id: string;
  repositoryId: string;
  status: TaskStatus;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
}

export interface HuntResponse {
  tasks: Task[];
  /** New tasks found in this hunt. */
  added: number;
  /** Pending tasks that no longer apply and were removed. */
  removed: number;
}

export interface UpdateTaskRequest {
  status: TaskStatus;
}

// --- System -----------------------------------------------------------------

export interface PickFolderResponse {
  /** Absolute path chosen in the native dialog, or null if the user cancelled. */
  path: string | null;
}

/**
 * Header the web app sends on every request that changes something (POST, DELETE).
 * A custom header forces the browser to ask permission first (CORS preflight),
 * so other websites can never trigger those actions.
 */
export const CLIENT_HEADER = 'x-sleepy-client';
export const CLIENT_HEADER_VALUE = 'web';

// --- Execution --------------------------------------------------------------

export type ExecutionMode = 'observer' | 'assistant' | 'work-session';

export const DEFAULT_EXECUTION_MODE: ExecutionMode = 'assistant';
