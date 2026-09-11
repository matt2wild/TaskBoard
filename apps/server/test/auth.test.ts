import { describe, it, expect, afterEach } from 'vitest';
import { makeHarness, type Harness } from './helpers.js';

let h: Harness;
afterEach(async () => { await h?.close(); });

describe('authentication and access control', () => {
  it('refuses unauthenticated API calls but allows the status probe', async () => {
    h = await makeHarness();
    const anon = await h.app.inject({ method: 'GET', url: '/api/v1/tasks' });
    expect(anon.statusCode).toBe(401);
    expect(anon.headers['content-type']).toContain('application/problem+json');

    const status = await h.app.inject({ method: 'GET', url: '/api/v1/auth/status' });
    expect(status.statusCode).toBe(200);
    expect(JSON.parse(status.body).setupComplete).toBe(true);
  });

  it('rejects a wrong password without leaking which part was wrong', async () => {
    h = await makeHarness();
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      payload: { username: 'tester', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).detail).toBe('Wrong username or password');
  });

  it('issues API tokens that can be read-only', async () => {
    h = await makeHarness();
    const token = await h.api('POST', '/api/v1/auth/tokens', { name: 'reader', scope: 'read' });
    expect(token.token).toBeTruthy();

    const read = await h.app.inject({
      method: 'GET', url: '/api/v1/tasks', headers: { authorization: `Bearer ${token.token}` },
    });
    expect(read.statusCode).toBe(200);

    const write = await h.app.inject({
      method: 'POST', url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${token.token}` },
      payload: { title: 'nope' },
    });
    expect(write.statusCode).toBe(403);
  });

  it('keeps at least one admin', async () => {
    h = await makeHarness();
    const code = await h.status('PATCH', `/api/v1/members/${h.userId}`, { role: 'member' });
    expect(code).toBe(400);
  });

  it('validates bodies into 422 with field detail', async () => {
    h = await makeHarness();
    const res = await h.app.inject({
      method: 'POST', url: '/api/v1/tasks', headers: { cookie: h.cookie }, payload: { title: '' },
    });
    expect(res.statusCode).toBe(422);
    const problem = JSON.parse(res.body);
    expect(problem.status).toBe(422);
    expect(problem.errors.title).toBeTruthy();
  });
});
