import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from '@sleepy-coder/shared';

/** Headers the real web app sends on POST/DELETE (see src/security.ts). */
export const clientHeaders = { [CLIENT_HEADER]: CLIENT_HEADER_VALUE };