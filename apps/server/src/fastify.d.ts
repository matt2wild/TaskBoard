import type { Ctx } from './core/ctx.js';
declare module 'fastify' {
  interface FastifyRequest { ctx: Ctx }
}
export {};
