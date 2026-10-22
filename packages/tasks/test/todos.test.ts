import { describe, expect, it } from 'vitest';
import { findTodosInText, todoToTask } from '../src/index.js';

const texts = (content: string) => findTodosInText('a.ts', content).map((t) => [t.marker, t.text, t.line]);

describe('findTodosInText', () => {
  it('finds markers in the common comment styles', () => {
    const content = [
      '// TODO: validate the email',
      'x = 1 # FIXME handle None',
      '/* HACK: temporary workaround */',
      ' * XXX check this',
      '<!-- TODO: add alt text -->',
      '{/* TODO: translate */}',
      '-- TODO(naza): index this column',
    ].join('\n');

    expect(texts(content)).toEqual([
      ['TODO', 'validate the email', 1],
      ['FIXME', 'handle None', 2],
      ['HACK', 'temporary workaround', 3],
      ['XXX', 'check this', 4],
      ['TODO', 'add alt text', 5],
      ['TODO', 'translate', 6],
      ['TODO', 'index this column', 7],
    ]);
  });

  it('ignores the Spanish word "todo" and lowercase markers', () => {
    const content = ['// todo bien, todo listo', '// Todo el mundo', 'const todo = []; // todo: lowercase'].join('\n');
    expect(texts(content)).toEqual([]);
  });

  it('ignores markers outside comments', () => {
    expect(texts('const label = "TODO list";\nTODO();')).toEqual([]);
  });

  it('ignores comment-like text inside strings', () => {
    const content = [
      "const sample = '// TODO: not a real comment';",
      'const html = "<!-- FIXME: example -->";',
      'const tpl = `# HACK inside a template`;',
    ].join('\n');
    expect(texts(content)).toEqual([]);
  });

  it('still finds comments after a closed string', () => {
    expect(texts("const a = 'x'; // TODO: real one")).toEqual([['TODO', 'real one', 1]]);
  });

  it('cuts the text at the end of an HTML comment', () => {
    expect(texts('<nav><!-- FIXME: falta aria-label --></nav>')).toEqual([['FIXME', 'falta aria-label', 1]]);
  });

  it('ignores words that only start with a marker', () => {
    expect(texts('// TODOS los casos\n// FIXMEPLEASE')).toEqual([]);
  });

  it('keeps empty TODOs', () => {
    expect(texts('// TODO')).toEqual([['TODO', '', 1]]);
  });
});

describe('todoToTask', () => {
  it('builds a task with the location', () => {
    const task = todoToTask({ path: 'src/app.ts', line: 12, marker: 'FIXME', text: 'handle errors' });

    expect(task).toMatchObject({
      source: 'static',
      title: 'FIXME: handle errors',
      description: 'FIXME comment in `src/app.ts:12`: "handle errors".',
      category: 'todo',
      priority: 'high',
      affectedFiles: ['src/app.ts'],
    });
  });

  it('keeps the same fingerprint when the comment moves to another line', () => {
    const a = todoToTask({ path: 'a.ts', line: 3, marker: 'TODO', text: 'x' });
    const b = todoToTask({ path: 'a.ts', line: 40, marker: 'TODO', text: 'x' });
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('uses the line for empty comments so they stay unique', () => {
    const a = todoToTask({ path: 'a.ts', line: 3, marker: 'TODO', text: '' });
    const b = todoToTask({ path: 'a.ts', line: 9, marker: 'TODO', text: '' });
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(a.title).toBe('TODO in `a.ts:3`');
  });

  it('shortens very long titles', () => {
    const task = todoToTask({ path: 'a.ts', line: 1, marker: 'TODO', text: 'x'.repeat(200) });
    expect(task.title.length).toBeLessThanOrEqual(86);
    expect(task.title.endsWith('…')).toBe(true);
  });
});
