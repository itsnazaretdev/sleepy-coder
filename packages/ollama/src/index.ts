export { createOllamaClient, DEFAULT_OLLAMA_URL, type OllamaClientOptions } from './client.js';
export { OllamaError, isOllamaError, type OllamaErrorCode } from './errors.js';
export { selectModel, normalizeModelName, PREFERRED_FAMILY_PREFIX, type ModelSelection } from './models.js';
export type { ChatMessage, ChatRequest, ChatResult, ChatRole, OllamaClient, OllamaModel } from './types.js';
