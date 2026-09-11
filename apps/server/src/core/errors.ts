import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { ProblemDetails } from '@homestead/shared';

/** RFC 9457 Problem Details (API-006). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: Record<string, string[]>,
    readonly type = 'about:blank',
  ) { super(detail ?? title); }

  toProblem(instance?: string): ProblemDetails {
    return { type: this.type, title: this.title, status: this.status, detail: this.detail, instance, errors: this.errors };
  }
}

export const badRequest = (d?: string, e?: Record<string, string[]>) => new ApiError(400, 'Bad Request', d, e);
export const unauthorized = (d = 'Authentication required') => new ApiError(401, 'Unauthorized', d);
export const forbidden = (d = 'You do not have access to this') => new ApiError(403, 'Forbidden', d);
export const notFound = (what = 'Resource') => new ApiError(404, 'Not Found', `${what} not found`);
export const conflict = (d: string) => new ApiError(409, 'Conflict', d);
export const unprocessable = (d: string, e?: Record<string, string[]>) => new ApiError(422, 'Unprocessable Content', d, e);

export function installErrorHandler(app: {
  setErrorHandler: (h: (e: Error, req: FastifyRequest, reply: FastifyReply) => void) => void;
  log: { error: (o: unknown, m?: string) => void };
}): void {
  app.setErrorHandler((err, req, reply) => {
    const anyErr = err as Error & { statusCode?: number; validation?: unknown; code?: string };
    if (err instanceof ZodError) {
      const errors: Record<string, string[]> = {};
      for (const issue of err.issues) {
        const key = issue.path.join('.') || '_';
        (errors[key] ??= []).push(issue.message);
      }
      const p = unprocessable('Some fields are not valid', errors).toProblem(req.url);
      reply.status(422).type('application/problem+json').send(p);
      return;
    }
    if (err instanceof ApiError) {
      reply.status(err.status).type('application/problem+json').send(err.toProblem(req.url));
      return;
    }
    if (anyErr.code === 'SQLITE_CONSTRAINT_UNIQUE' || anyErr.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      const p = conflict('That value is already taken').toProblem(req.url);
      reply.status(409).type('application/problem+json').send(p);
      return;
    }
    if (anyErr.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      const p = unprocessable('Referenced record does not exist').toProblem(req.url);
      reply.status(422).type('application/problem+json').send(p);
      return;
    }
    const status = anyErr.statusCode && anyErr.statusCode >= 400 ? anyErr.statusCode : 500;
    if (status >= 500) app.log.error({ err, url: req.url }, 'unhandled error');
    reply.status(status).type('application/problem+json').send({
      type: 'about:blank',
      title: status >= 500 ? 'Internal Server Error' : 'Request Error',
      status,
      detail: status >= 500 ? 'Something went wrong' : err.message,
      instance: req.url,
    } satisfies ProblemDetails);
  });
}
