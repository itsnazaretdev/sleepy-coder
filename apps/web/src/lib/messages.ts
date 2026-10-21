/** User-facing (Spanish) explanations for backend error codes. */
const ERROR_MESSAGES: Record<string, string> = {
  unreachable: 'Ollama no está encendido. Abre la app de Ollama o ejecuta "ollama serve".',
  timeout: 'Ollama tardó demasiado en responder. Puede que el modelo siga cargando; inténtalo otra vez.',
  'model-not-found': 'El modelo configurado no está instalado en Ollama.',
  'bad-response': 'Ollama respondió con un error inesperado.',
  'no-model': 'No hay ningún modelo disponible. Instala uno con "ollama pull gemma3:4b".',
};

export function describeError(code: string): string {
  return ERROR_MESSAGES[code] ?? 'Algo ha fallado al hablar con el backend.';
}
