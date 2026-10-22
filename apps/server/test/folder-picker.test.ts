import { describe, expect, it } from 'vitest';
import {
  createFolderPicker,
  FolderPickerError,
  normalizePickedPath,
  type CommandResult,
  type CommandRunner,
} from '../src/services/folder-picker.js';

/** Fake runner that records the call and returns a fixed result. */
function fakeRunner(result: CommandResult | Error) {
  const calls: Array<{ file: string; args: string[] }> = [];
  const run: CommandRunner = async (file, args) => {
    calls.push({ file, args });
    if (result instanceof Error) throw result;
    return result;
  };
  return { run, calls };
}

const ok = (stdout: string): CommandResult => ({ exitCode: 0, stdout, stderr: '' });

async function errorCode(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FolderPickerError);
  return (error as FolderPickerError).code;
}

describe('normalizePickedPath', () => {
  it('trims whitespace and the trailing slash', () => {
    expect(normalizePickedPath('/Users/naz/Desktop/sleepy-coder/\n')).toBe('/Users/naz/Desktop/sleepy-coder');
  });

  it('keeps the root folder', () => {
    expect(normalizePickedPath('/\n')).toBe('/');
  });
});

describe('createFolderPicker on macOS', () => {
  it('runs osascript with fixed arguments and returns the chosen path', async () => {
    const { run, calls } = fakeRunner(ok('/Users/naz/Desktop/sleepy-coder/\n'));
    const picker = createFolderPicker({ platform: 'darwin', run });

    expect(picker.supported).toBe(true);
    expect(await picker.pick()).toBe('/Users/naz/Desktop/sleepy-coder');
    expect(calls[0]?.file).toBe('osascript');
    expect(calls[0]?.args.join(' ')).toContain('choose folder');
  });

  it('returns null when the user cancels', async () => {
    const { run } = fakeRunner({ exitCode: 1, stdout: '', stderr: 'execution error: User canceled. (-128)' });
    expect(await createFolderPicker({ platform: 'darwin', run }).pick()).toBeNull();
  });

  it('reports other AppleScript failures', async () => {
    const { run } = fakeRunner({ exitCode: 1, stdout: '', stderr: 'execution error: Something else (-1700)' });
    expect(await errorCode(createFolderPicker({ platform: 'darwin', run }).pick())).toBe('picker-failed');
  });
});

describe('createFolderPicker on Linux', () => {
  it('uses zenity', async () => {
    const { run, calls } = fakeRunner(ok('/home/naz/code/app\n'));
    expect(await createFolderPicker({ platform: 'linux', run }).pick()).toBe('/home/naz/code/app');
    expect(calls[0]?.file).toBe('zenity');
  });

  it('treats exit code 1 as cancel', async () => {
    const { run } = fakeRunner({ exitCode: 1, stdout: '', stderr: '' });
    expect(await createFolderPicker({ platform: 'linux', run }).pick()).toBeNull();
  });

  it('reports unsupported when zenity is not installed', async () => {
    const missing = Object.assign(new Error('spawn zenity ENOENT'), { code: 'ENOENT' });
    const { run } = fakeRunner(missing);
    expect(await errorCode(createFolderPicker({ platform: 'linux', run }).pick())).toBe('unsupported-platform');
  });
});

describe('createFolderPicker in general', () => {
  it('is unsupported on other platforms and never runs anything', async () => {
    const { run, calls } = fakeRunner(ok('/x'));
    const picker = createFolderPicker({ platform: 'win32', run });

    expect(picker.supported).toBe(false);
    expect(await errorCode(picker.pick())).toBe('unsupported-platform');
    expect(calls).toHaveLength(0);
  });

  it('refuses to open a second dialog while one is open', async () => {
    let finish: (r: CommandResult) => void = () => {};
    const run: CommandRunner = () => new Promise((resolve) => (finish = resolve));
    const picker = createFolderPicker({ platform: 'darwin', run });

    const first = picker.pick();
    expect(await errorCode(picker.pick())).toBe('picker-busy');

    finish(ok('/a\n'));
    expect(await first).toBe('/a');
    // Once closed, it can be opened again.
    const again = picker.pick();
    finish(ok('/b\n'));
    expect(await again).toBe('/b');
  });

  it('reports a failure when the command cannot run', async () => {
    const { run } = fakeRunner(Object.assign(new Error('killed'), { killed: true }));
    expect(await errorCode(createFolderPicker({ platform: 'darwin', run }).pick())).toBe('picker-failed');
  });
});