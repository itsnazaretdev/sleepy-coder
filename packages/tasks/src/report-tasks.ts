import type { StructureReport, TaskDraft } from '@sleepy-coder/shared';

/** Suggests a test tool that fits the project's languages. */
function suggestTestTool(structure: StructureReport): string {
  const languages = new Set(structure.languages.map((l) => l.language));
  if (languages.has('TypeScript') || languages.has('JavaScript') || languages.has('Astro')) return 'Vitest';
  if (languages.has('Java') || languages.has('Kotlin')) return 'JUnit 5';
  if (languages.has('Python')) return 'pytest';
  if (languages.has('PHP')) return 'PHPUnit';
  return 'the usual test framework for the language';
}

/**
 * Turns gaps found in the structure report into tasks.
 * Git state (uncommitted changes) is not a task: it is something to sort out before a session.
 */
export function tasksFromStructure(structure: StructureReport): TaskDraft[] {
  const tasks: TaskDraft[] = [];

  if (structure.files.testFiles === 0 && structure.languages.length > 0) {
    const tool = structure.testingTools[0] ?? suggestTestTool(structure);
    tasks.push({
      fingerprint: 'report:no-tests',
      source: 'static',
      title: 'Add the first tests',
      description: 'The repository has no test files.',
      category: 'tests',
      priority: 'medium',
      complexity: 'medium',
      risk: 'low',
      affectedFiles: [],
      suggestedImplementation: `Set up ${tool} and write tests for the functions with the most logic, starting with the easiest ones to isolate.`,
    });
  }

  if (!structure.hasReadme) {
    tasks.push({
      fingerprint: 'report:no-readme',
      source: 'static',
      title: 'Create a README',
      description: 'There is no README at the root of the repository.',
      category: 'documentation',
      priority: 'medium',
      complexity: 'small',
      risk: 'low',
      affectedFiles: ['README.md'],
      suggestedImplementation:
        'Create `README.md` explaining what the project does, how to install and run it, and which technologies it uses.',
    });
  }

  if (!structure.hasLicense) {
    tasks.push({
      fingerprint: 'report:no-license',
      source: 'static',
      title: 'Add a license',
      description: 'There is no LICENSE file. Without a license, nobody can legally reuse the code.',
      category: 'documentation',
      priority: 'low',
      complexity: 'small',
      risk: 'low',
      affectedFiles: ['LICENSE'],
      suggestedImplementation:
        'Choose a license (MIT is the most common one for personal projects) and add its text in a `LICENSE` file.',
    });
  }

  return tasks;
}
