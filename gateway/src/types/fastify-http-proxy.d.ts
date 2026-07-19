import type { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';

/**
 * @fastify/http-proxy ships no bundled TypeScript types. This is a minimal
 * ambient declaration covering only the options this gateway actually uses.
 *
 * Note: @fastify/reply-from invokes `rewriteRequestHeaders(this.request, headers)`
 * where `this` is the FastifyReply — so the first argument is the
 * FastifyRequest, not the raw Node IncomingMessage.
 */
declare module '@fastify/http-proxy' {
  export interface FastifyHttpProxyReplyOptions {
    rewriteRequestHeaders?: (
      originalReq: FastifyRequest,
      headers: Record<string, string | string[] | undefined>,
    ) => Record<string, string | string[] | undefined>;
    [key: string]: unknown;
  }

  export interface FastifyHttpProxyOptions {
    upstream: string;
    prefix?: string;
    rewritePrefix?: string;
    http2?: boolean;
    httpMethods?: string[];
    preHandler?: (request: FastifyRequest, reply: FastifyReply) => void | Promise<void>;
    replyOptions?: FastifyHttpProxyReplyOptions;
    [key: string]: unknown;
  }

  const fastifyHttpProxy: FastifyPluginCallback<FastifyHttpProxyOptions>;
  export default fastifyHttpProxy;
}
