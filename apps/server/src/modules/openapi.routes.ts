import type { FastifyInstance } from 'fastify';
import { ENTITY_TYPES, MODULE_KEYS, NOTIFICATION_EVENTS } from '@homestead/shared';

/**
 * A hand-maintained OpenAPI outline (API-002). Fastify knows every route it has
 * registered, so the path list is generated from the router itself and cannot
 * drift; the descriptions below give each group its meaning.
 */
const GROUPS: Array<{ prefix: string; name: string; description: string }> = [
  { prefix: '/api/v1/auth', name: 'Auth', description: 'Setup, sign-in, sessions and API tokens.' },
  { prefix: '/api/v1/members', name: 'Members', description: 'Household members and invites.' },
  { prefix: '/api/v1/properties', name: 'Properties', description: 'The buildings the household manages.' },
  { prefix: '/api/v1/locations', name: 'Locations', description: 'The location tree shared by assets, storage and the pantry.' },
  { prefix: '/api/v1/assets', name: 'Assets', description: 'Appliances, systems and fixtures, with history and cost of ownership.' },
  { prefix: '/api/v1/tasks', name: 'Tasks', description: 'The task engine every module schedules through.' },
  { prefix: '/api/v1/schedules', name: 'Schedules', description: 'Fixed and floating recurrence.' },
  { prefix: '/api/v1/boards', name: 'Boards', description: 'Kanban views over tasks.' },
  { prefix: '/api/v1/maintenance', name: 'Maintenance', description: 'Plans, records, the template library and warranties.' },
  { prefix: '/api/v1/projects', name: 'Projects', description: 'Renovation planning: phases, materials, quotes, permits, decisions.' },
  { prefix: '/api/v1/transactions', name: 'Budget', description: 'Transactions, splits and attributions.' },
  { prefix: '/api/v1/budget', name: 'Budget reports', description: 'Allocations, reports and long-range planning.' },
  { prefix: '/api/v1/bills', name: 'Bills', description: 'Recurring bills and payment.' },
  { prefix: '/api/v1/products', name: 'Products', description: 'The catalogue behind food and every other consumable.' },
  { prefix: '/api/v1/stock', name: 'Stock', description: 'Pantry lots, expiry, consumption and audits.' },
  { prefix: '/api/v1/shopping-lists', name: 'Shopping', description: 'Lists, check-off and put-away.' },
  { prefix: '/api/v1/recipes', name: 'Recipes', description: 'Recipes measured against what is in the house.' },
  { prefix: '/api/v1/storage-items', name: 'Storage', description: 'Things you want to find later.' },
  { prefix: '/api/v1/loans', name: 'Loans', description: 'What is lent out and what is borrowed.' },
  { prefix: '/api/v1/tools', name: 'Tools', description: 'Tools, consumables, batteries and checkout.' },
  { prefix: '/api/v1/pets', name: 'Pets', description: 'Cat health: doses, visits, weight, conditions and care sheets.' },
  { prefix: '/api/v1/contacts', name: 'Contacts', description: 'Contractors, vets, vendors and their history.' },
  { prefix: '/api/v1/dashboard', name: 'Dashboard', description: 'The Today screen and the weekly review.' },
  { prefix: '/api/v1/notifications', name: 'Notifications', description: 'Inbox, preferences and the delivery log.' },
  { prefix: '/api/v1/admin', name: 'Admin', description: 'Status, backup, export and scheduler control.' },
  { prefix: '/api/v1/capture', name: 'Capture', description: 'Minimal endpoints for automations and NFC tags.' },
  { prefix: '/api/v1', name: 'Other', description: 'Everything else.' },
];

export function openApiRoutes(app: FastifyInstance): void {
  // Fastify tells us about every route as it is registered, so the spec is
  // generated from the router itself and cannot drift from it.
  const routes: Array<{ method: string; url: string }> = [];
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      routes.push({ method, url: route.url });
    }
  });

  app.get('/api/v1/openapi.json', async () => {

    const paths: Record<string, Record<string, unknown>> = {};
    for (const r of routes) {
      if (!r.url.startsWith('/api/')) continue;
      const group = GROUPS.find((g) => r.url.startsWith(g.prefix)) ?? GROUPS.at(-1)!;
      const url = r.url.replace(/:([\w]+)/g, '{$1}');
      paths[url] ??= {};
      paths[url]![r.method.toLowerCase()] = {
        tags: [group.name],
        summary: `${r.method} ${url}`,
        parameters: [...url.matchAll(/\{(\w+)\}/g)].map((m) => ({
          name: m[1], in: 'path', required: true, schema: { type: 'string' },
        })),
        responses: {
          200: { description: 'Success' },
          401: { description: 'Not signed in', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          422: { description: 'Validation failed', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      };
    }

    return {
      openapi: '3.1.0',
      info: {
        title: 'Homestead API',
        version: '0.1.0',
        description: [
          'The self-hosted home management API. The web client uses these endpoints and no others.',
          '',
          'Conventions: money is an integer in minor units; dates are `YYYY-MM-DD` in the household',
          'timezone; list endpoints take `limit`, `cursor`, `q`, `sort` and `dir`; errors are RFC 9457',
          'Problem Details; mutations accept `updatedAt` for optimistic concurrency.',
        ].join('\n'),
        license: { name: 'AGPL-3.0-or-later' },
      },
      servers: [{ url: '/' }],
      tags: GROUPS.map((g) => ({ name: g.name, description: g.description })),
      components: {
        securitySchemes: {
          session: { type: 'apiKey', in: 'cookie', name: 'homestead_session' },
          token: { type: 'http', scheme: 'bearer' },
        },
        schemas: {
          Problem: {
            type: 'object',
            properties: {
              type: { type: 'string' }, title: { type: 'string' }, status: { type: 'integer' },
              detail: { type: 'string' }, instance: { type: 'string' },
              errors: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
            },
          },
          Page: {
            type: 'object',
            properties: {
              items: { type: 'array', items: {} },
              nextCursor: { type: ['string', 'null'] },
              total: { type: 'integer' },
            },
          },
        },
      },
      security: [{ session: [] }, { token: [] }],
      paths,
      'x-homestead': {
        entityTypes: ENTITY_TYPES,
        modules: MODULE_KEYS,
        notificationEvents: NOTIFICATION_EVENTS,
        routeCount: Object.keys(paths).length,
      },
    };
  });

  app.get('/api/v1/docs', async (_req, reply) => {
    reply.type('text/html');
    return `<!doctype html><html><head><meta charset="utf-8"><title>Homestead API</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px/1.6 system-ui,sans-serif;margin:0;padding:2rem;max-width:60rem;margin-inline:auto;color:#1c1917}
h1{margin-top:0}code{background:#f5f5f4;padding:.15em .4em;border-radius:4px}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.4rem .6rem;border-bottom:1px solid #e7e5e4}
a{color:#0369a1}</style></head><body>
<h1>Homestead API</h1>
<p>The machine-readable description is at <a href="openapi.json"><code>/api/v1/openapi.json</code></a>.
Point any OpenAPI viewer at it.</p>
<h2>Conventions</h2>
<table>
<tr><th>Money</th><td>Integer minor units. <code>1234</code> is 12.34.</td></tr>
<tr><th>Dates</th><td><code>YYYY-MM-DD</code>, in the household timezone.</td></tr>
<tr><th>Lists</th><td><code>?limit=&amp;cursor=&amp;q=&amp;sort=&amp;dir=</code>, plus per-field filters and <code>field_gte</code> ranges.</td></tr>
<tr><th>Errors</th><td>RFC 9457 Problem Details, <code>application/problem+json</code>.</td></tr>
<tr><th>Concurrency</th><td>Send the <code>updatedAt</code> you read; a stale value returns 409.</td></tr>
<tr><th>Auth</th><td>Session cookie, or <code>Authorization: Bearer &lt;token&gt;</code>.</td></tr>
</table>
</body></html>`;
  });
}
