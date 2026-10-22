import type { ReportWarningCode } from '@sleepy-coder/shared';

/** User-facing explanations for backend error codes. */
const ERROR_MESSAGES: Record<string, string> = {
  // Ollama
  unreachable: 'Ollama is not running. Open the Ollama app or run "ollama serve".',
  timeout: 'Ollama took too long to answer. The model may still be loading; try again.',
  'model-not-found': 'The configured model is not installed in Ollama.',
  'bad-response': 'Ollama answered with an unexpected error.',
  'no-model': 'No model available. Install one with "ollama pull gemma3:4b".',

  // Repositories
  'invalid-path': 'Type an absolute path, for example /Users/you/Projects/my-app.',
  'not-found': "That folder doesn't exist. Check the path.",
  'not-a-directory': 'That path is a file, not a folder.',
  'not-a-git-repo': 'That folder is not the root of a Git repository (it has no .git folder).',
  'already-added': 'That repository is already in the list.',
  'repository-not-found': 'That repository is no longer in the list.',

  // Tasks
  'task-not-found': 'That task no longer exists. Look for tasks again.',
  'ai-busy': 'Gemma is already working on other suggestions. Wait for it to finish.',
  'ai-invalid-output': "The model answered with something I couldn't understand. Try again.",

  // Folder picker
  'unsupported-platform': "The folder picker isn't available on this system. Type the path instead.",
  'picker-busy': 'A folder window is already open. Look for it; it may be behind the browser.',
  'picker-failed': "The folder picker couldn't be opened. Try typing the path instead.",
};

export function describeError(code: string): string {
  return ERROR_MESSAGES[code] ?? 'Something went wrong while talking to the backend.';
}

export const WARNING_MESSAGES: Record<ReportWarningCode, string> = {
  'uncommitted-changes': 'There are uncommitted changes. Commit them before the agent works on this repository.',
  'no-tests': 'No test files found.',
  'no-readme': 'There is no README at the root.',
  'no-license': 'There is no LICENSE file.',
  'scan-truncated': 'The repository is very large: only the first 20,000 files were analyzed.',
};
