import {
  CLIENT_HEADER,
  CLIENT_HEADER_VALUE,
  SERVER_URL,
  type AddRepositoryRequest,
  type ApiError,
  type AppConfigResponse,
  type CheckTaskResponse,
  type HealthResponse,
  type HuntResponse,
  type OllamaStatusResponse,
  type OllamaTestResponse,
  type PickFolderResponse,
  type Repository,
  type RepositoryReport,
  type Task,
  type TaskGuideResponse,
  type TaskRun,
  type TaskStatus,
  type UpdateTaskRequest,
} from '@sleepy-coder/shared';

const DEFAULT_TIMEOUT_MS = 3_000;
/** The first prompt loads the model into memory; give it time. */
const MODEL_TEST_TIMEOUT_MS = 130_000;
/** Big repositories can take a few seconds to scan. */
const ANALYSIS_TIMEOUT_MS = 60_000;

/** Error thrown for non-2xx API responses, carrying the backend's error code. */
export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  // The backend only accepts actions (POST, DELETE) that carry this header.
  if (method !== 'GET') headers.set(CLIENT_HEADER, CLIENT_HEADER_VALUE);

  const response = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as Partial<ApiError> | null;
    throw new ApiRequestError(
      response.status,
      body?.error ?? 'http-error',
      body?.message ?? `Request failed with status ${response.status}`,
    );
  }

  // 204 No Content has no body to parse.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Fetches the backend health status. Throws if the server is down or slow. */
export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

/** What the backend has turned on (the experimental agent is off by default). */
export function fetchConfig(): Promise<AppConfigResponse> {
  return request<AppConfigResponse>('/config');
}

// --- Ollama -----------------------------------------------------------------

export function fetchOllamaStatus(): Promise<OllamaStatusResponse> {
  return request<OllamaStatusResponse>('/ollama/status', {}, 8_000);
}

export function testOllamaModel(): Promise<OllamaTestResponse> {
  return request<OllamaTestResponse>('/ollama/test', { method: 'POST' }, MODEL_TEST_TIMEOUT_MS);
}

// --- Repositories -----------------------------------------------------------

export function fetchRepositories(): Promise<Repository[]> {
  return request<Repository[]>('/repositories');
}

export function addRepository(path: string): Promise<Repository> {
  const body: AddRepositoryRequest = { path };
  return request<Repository>(
    '/repositories',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    10_000,
  );
}

export function removeRepository(id: string): Promise<void> {
  return request<void>(`/repositories/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function analyzeRepository(id: string): Promise<RepositoryReport> {
  return request<RepositoryReport>(`/repositories/${encodeURIComponent(id)}/analysis`, {}, ANALYSIS_TIMEOUT_MS);
}

// --- Tasks ------------------------------------------------------------------

export function fetchTasks(repositoryId: string): Promise<Task[]> {
  return request<Task[]>(`/repositories/${encodeURIComponent(repositoryId)}/tasks`);
}

/** Looks for new tasks in the repository (no AI). */
export function huntTasks(repositoryId: string): Promise<HuntResponse> {
  return request<HuntResponse>(
    `/repositories/${encodeURIComponent(repositoryId)}/tasks/hunt`,
    { method: 'POST' },
    ANALYSIS_TIMEOUT_MS,
  );
}

/** Asks the local model for improvement tasks. Slow: the model reads part of the code. */
export function suggestTasks(repositoryId: string): Promise<HuntResponse> {
  return request<HuntResponse>(
    `/repositories/${encodeURIComponent(repositoryId)}/tasks/suggest`,
    { method: 'POST' },
    200_000, // the backend gives the model up to 3 minutes
  );
}

export function updateTaskStatus(id: string, status: TaskStatus): Promise<Task> {
  const body: UpdateTaskRequest = { status };
  return request<Task>(`/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// --- Fix guides -------------------------------------------------------------

/** Where the problem is (no AI) and the last guide written by the model, if any. */
export function fetchTaskGuide(taskId: string): Promise<TaskGuideResponse> {
  return request<TaskGuideResponse>(`/tasks/${encodeURIComponent(taskId)}/guide`, {}, 15_000);
}

/** Asks the local model how to fix the task. Slow; nothing is changed in the repository. */
export function createTaskGuide(taskId: string): Promise<TaskGuideResponse> {
  return request<TaskGuideResponse>(`/tasks/${encodeURIComponent(taskId)}/guide`, { method: 'POST' }, 200_000);
}

/** Runs the rules again: if the problem is gone, the task becomes "done". */
export function checkTask(taskId: string): Promise<CheckTaskResponse> {
  return request<CheckTaskResponse>(`/tasks/${encodeURIComponent(taskId)}/check`, { method: 'POST' }, ANALYSIS_TIMEOUT_MS);
}

// --- Agent runs (experimental) ----------------------------------------------

/** Starts the agent on an approved task. Returns right away with status "running". */
export function runTask(taskId: string): Promise<TaskRun> {
  return request<TaskRun>(`/tasks/${encodeURIComponent(taskId)}/run`, { method: 'POST' }, 15_000);
}

export function fetchRun(runId: string): Promise<TaskRun> {
  return request<TaskRun>(`/runs/${encodeURIComponent(runId)}`);
}

/** The latest run of each task of a repository. */
export function fetchLatestRuns(repositoryId: string): Promise<TaskRun[]> {
  return request<TaskRun[]>(`/repositories/${encodeURIComponent(repositoryId)}/runs`);
}

// --- System -----------------------------------------------------------------

/** Opens the native folder dialog (Finder on macOS). Resolves with null if cancelled. */
export async function pickFolder(): Promise<string | null> {
  // The user may take a while to choose; the backend gives up after 5 minutes.
  const { path } = await request<PickFolderResponse>('/system/pick-folder', { method: 'POST' }, 5 * 60_000 + 5_000);
  return path;
}
