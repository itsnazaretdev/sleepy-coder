import type { StructureReport, TaskDraft } from '@sleepy-coder/shared';

/** Suggests a test tool that fits the project's languages. */
function suggestTestTool(structure: StructureReport): string {
  const languages = new Set(structure.languages.map((l) => l.language));
  if (languages.has('TypeScript') || languages.has('JavaScript') || languages.has('Astro')) return 'Vitest';
  if (languages.has('Java') || languages.has('Kotlin')) return 'JUnit 5';
  if (languages.has('Python')) return 'pytest';
  if (languages.has('PHP')) return 'PHPUnit';
  return 'el framework de tests habitual del lenguaje';
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
      title: 'Añadir los primeros tests',
      description: 'El repositorio no tiene ningún archivo de test.',
      category: 'tests',
      priority: 'medium',
      complexity: 'medium',
      risk: 'low',
      affectedFiles: [],
      suggestedImplementation: `Configura ${tool} y escribe tests para las funciones con más lógica, empezando por las más sencillas de aislar.`,
    });
  }

  if (!structure.hasReadme) {
    tasks.push({
      fingerprint: 'report:no-readme',
      source: 'static',
      title: 'Crear un README',
      description: 'No hay README en la raíz del repositorio.',
      category: 'documentation',
      priority: 'medium',
      complexity: 'small',
      risk: 'low',
      affectedFiles: ['README.md'],
      suggestedImplementation:
        'Crea README.md con qué hace el proyecto, cómo instalarlo y ejecutarlo, y con qué tecnologías está hecho.',
    });
  }

  if (!structure.hasLicense) {
    tasks.push({
      fingerprint: 'report:no-license',
      source: 'static',
      title: 'Añadir una licencia',
      description: 'No hay archivo LICENSE. Sin licencia, nadie puede reutilizar el código legalmente.',
      category: 'documentation',
      priority: 'low',
      complexity: 'small',
      risk: 'low',
      affectedFiles: ['LICENSE'],
      suggestedImplementation:
        'Elige una licencia (MIT es la más común para proyectos personales) y añade el texto en un archivo LICENSE.',
    });
  }

  return tasks;
}
