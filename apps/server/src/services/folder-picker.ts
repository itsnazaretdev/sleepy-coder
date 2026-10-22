import { execFile } from 'node:child_process';

/**
 * Opens the operating system's native "choose folder" dialog.
 *
 * Browsers never reveal the real path of a folder to a web page, but this backend
 * runs on the user's own machine, so it can show the native dialog itself.
 * Commands and arguments are fixed: no user input ever reaches them.
 */

export type FolderPickerErrorCode = 'unsupported-platform' | 'picker-busy' | 'picker-failed';

export class FolderPickerError extends Error {
  readonly code: FolderPickerErrorCode;

  constructor(code: FolderPickerErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FolderPickerError';
    this.code = code;
  }
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs a program without a shell. Rejects only if it cannot run (e.g. not installed) or times out. */
export type CommandRunner = (file: string, args: string[], timeoutMs: number) => Promise<CommandResult>;

export const runCommand: CommandRunner = (file, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (!error) return resolve({ exitCode: 0, stdout, stderr });
      // A numeric code means the program ran and exited with that status.
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'number') return resolve({ exitCode: code, stdout, stderr });
      reject(error);
    });
  });

interface PickerCommand {
  file: string;
  args: string[];
  isCancel: (result: CommandResult) => boolean;
}

const PROMPT = 'Elige la carpeta raíz de un repositorio Git';

function commandFor(platform: NodeJS.Platform): PickerCommand | null {
  if (platform === 'darwin') {
    return {
      file: 'osascript',
      // `activate` brings the dialog to the front instead of hiding it behind the browser.
      args: ['-e', 'activate', '-e', `POSIX path of (choose folder with prompt "${PROMPT}")`],
      // AppleScript error -128 = "User canceled."
      isCancel: (r) => r.exitCode === 1 && /-128|cancel/i.test(r.stderr),
    };
  }
  if (platform === 'linux') {
    return {
      file: 'zenity',
      args: ['--file-selection', '--directory', `--title=${PROMPT}`],
      isCancel: (r) => r.exitCode === 1,
    };
  }
  return null;
}

/** "/Users/me/app/\n" → "/Users/me/app" (the root "/" is kept as is). */
export function normalizePickedPath(stdout: string): string {
  const path = stdout.trim();
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

export interface FolderPicker {
  readonly supported: boolean;
  /** Resolves with the chosen absolute path, or null if the user cancelled. */
  pick(): Promise<string | null>;
}

export interface FolderPickerOptions {
  platform?: NodeJS.Platform;
  run?: CommandRunner;
  /** How long to wait for the user before giving up. */
  timeoutMs?: number;
}

export function createFolderPicker(options: FolderPickerOptions = {}): FolderPicker {
  const command = commandFor(options.platform ?? process.platform);
  const run = options.run ?? runCommand;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  let busy = false;

  const unsupported = (cause?: unknown) =>
    new FolderPickerError(
      'unsupported-platform',
      'A native folder dialog is not available on this system. Type the path instead.',
      { cause },
    );

  return {
    supported: command !== null,

    async pick() {
      if (!command) throw unsupported();
      if (busy) throw new FolderPickerError('picker-busy', 'The folder dialog is already open.');

      busy = true;
      try {
        let result: CommandResult;
        try {
          result = await run(command.file, command.args, timeoutMs);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw unsupported(error);
          throw new FolderPickerError('picker-failed', 'The folder dialog could not be shown.', { cause: error });
        }

        if (result.exitCode !== 0) {
          if (command.isCancel(result)) return null;
          throw new FolderPickerError('picker-failed', result.stderr.trim() || `Exited with code ${result.exitCode}`);
        }

        return normalizePickedPath(result.stdout) || null;
      } finally {
        busy = false;
      }
    },
  };
}