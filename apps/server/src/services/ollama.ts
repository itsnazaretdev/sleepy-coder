import { isOllamaError, selectModel, type OllamaClient } from '@sleepy-coder/ollama';
import type { OllamaStatusResponse, OllamaTestResponse } from '@sleepy-coder/shared';

/**
 * Business logic behind the /ollama routes, kept free of Fastify so it is
 * easy to test with a fake client.
 */

export async function getOllamaStatus(
  client: OllamaClient,
  configuredModel: string | null,
): Promise<OllamaStatusResponse> {
  try {
    const [version, models] = await Promise.all([client.getVersion(), client.listModels()]);
    const selection = selectModel(models, configuredModel);

    return {
      running: true,
      url: client.baseUrl,
      version,
      models,
      selectedModel: selection.name,
      selectedModelAvailable: selection.available,
      selectionSource: selection.source,
    };
  } catch (error) {
    // Ollama being off is a normal state, not a server error.
    if (isOllamaError(error)) {
      return { running: false, url: client.baseUrl, errorCode: error.code, message: error.message };
    }
    throw error;
  }
}

export class NoModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoModelError';
  }
}

const TEST_PROMPT =
  'Responde en una sola frase corta y en español: ¿estás listo para ayudar con tareas de programación?';

/** Sends a tiny prompt to the selected model to check it really answers. */
export async function runOllamaTest(
  client: OllamaClient,
  configuredModel: string | null,
): Promise<OllamaTestResponse> {
  const models = await client.listModels();
  const selection = selectModel(models, configuredModel);

  if (!selection.name) {
    throw new NoModelError('No models are installed in Ollama. Run "ollama pull gemma3:4b".');
  }
  if (!selection.available) {
    throw new NoModelError(`Configured model "${selection.name}" is not installed.`);
  }

  const result = await client.chat({
    model: selection.name,
    messages: [{ role: 'user', content: TEST_PROMPT }],
    temperature: 0.2,
  });

  return { model: result.model, reply: result.content, durationMs: result.durationMs };
}
