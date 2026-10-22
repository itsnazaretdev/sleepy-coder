import type { ReportWarningCode } from '@sleepy-coder/shared';

/** User-facing (Spanish) explanations for backend error codes. */
const ERROR_MESSAGES: Record<string, string> = {
  // Ollama
  unreachable: 'Ollama no está encendido. Abre la app de Ollama o ejecuta "ollama serve".',
  timeout: 'Ollama tardó demasiado en responder. Puede que el modelo siga cargando; inténtalo otra vez.',
  'model-not-found': 'El modelo configurado no está instalado en Ollama.',
  'bad-response': 'Ollama respondió con un error inesperado.',
  'no-model': 'No hay ningún modelo disponible. Instala uno con "ollama pull gemma3:4b".',

  // Repositories
  'invalid-path': 'Escribe una ruta absoluta, por ejemplo /Users/tu-usuario/Proyectos/mi-app.',
  'not-found': 'No encuentro esa carpeta. Comprueba la ruta.',
  'not-a-directory': 'Esa ruta es un archivo, no una carpeta.',
  'not-a-git-repo': 'Esa carpeta no es la raíz de un repositorio Git (le falta la carpeta .git).',
  'already-added': 'Ese repositorio ya está en la lista.',
  'repository-not-found': 'Ese repositorio ya no está en la lista.',
  'task-not-found': 'Esa tarea ya no existe. Vuelve a buscar tareas.',
  'ai-busy': 'Gemma ya está pensando en otras sugerencias. Espera a que termine.',
  'ai-invalid-output': 'El modelo respondió algo que no he podido entender. Prueba otra vez.',

  // Folder picker
  'unsupported-platform': 'En este sistema no puedo abrir el selector de carpetas. Escribe la ruta a mano.',
  'picker-busy': 'Ya hay una ventana de selección abierta. Búscala, puede estar detrás del navegador.',
  'picker-failed': 'No se pudo abrir el selector de carpetas. Prueba a escribir la ruta a mano.',
};

export function describeError(code: string): string {
  return ERROR_MESSAGES[code] ?? 'Algo ha fallado al hablar con el backend.';
}

export const WARNING_MESSAGES: Record<ReportWarningCode, string> = {
  'uncommitted-changes': 'Hay cambios sin commitear. Guárdalos antes de que el agente trabaje en este repositorio.',
  'no-tests': 'No he encontrado archivos de test.',
  'no-readme': 'No hay README en la raíz.',
  'no-license': 'No hay archivo LICENSE.',
  'scan-truncated': 'El repositorio es muy grande: solo se analizaron los primeros 20.000 archivos.',
};
