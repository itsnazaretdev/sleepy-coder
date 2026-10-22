import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CLIENT_HEADER, CLIENT_HEADER_VALUE, type ApiError } from '@sleepy-coder/shared';

/**
 * Extra protection for a backend that listens on localhost.
 *
 * 1. Host check: only "localhost", "127.0.0.1" and "[::1]" are accepted. This blocks
 *    DNS rebinding, where a malicious domain is made to point at 127.0.0.1.
 *
 * 2. Client header on POST/DELETE: CORS stops other websites from *reading* responses,
 *    but a "simple" POST is still *sent*. Requiring a custom header makes the browser
 *    send a preflight first, which CORS rejects for any origin other than our web app.
 */

const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** "127.0.0.1:4317" → "127.0.0.1", "[::1]:4317" → "[::1]". */
export function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  if (hostHeader.startsWith('[')) return hostHeader.slice(0, hostHeader.indexOf(']') + 1).toLowerCase();
  return (hostHeader.split(':')[0] ?? '').toLowerCase();
}

function deny(reply: FastifyReply, error: string, message: string) {
  const body: ApiError = { error, message };
  return reply.code(403).send(body);
}

export function registerSecurity(app: FastifyInstance): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!ALLOWED_HOSTNAMES.has(hostnameOf(request.headers.host))) {
      return deny(reply, 'forbidden-host', 'Requests must be addressed to localhost.');
    }

    if (!SAFE_METHODS.has(request.method) && request.headers[CLIENT_HEADER] !== CLIENT_HEADER_VALUE) {
      return deny(reply, 'missing-client-header', `Missing ${CLIENT_HEADER} header.`);
    }
  });
}