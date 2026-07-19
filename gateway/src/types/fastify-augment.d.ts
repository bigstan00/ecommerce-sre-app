import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by the JWT preHandler once a token has been verified. */
    userId?: string;
  }
}
