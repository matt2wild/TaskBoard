/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CONTACT_TYPES } from '@homestead/shared';
import {
  contacts, loans, maintenanceRecords, payees, petVisits, quotes, serviceAccounts, transactions,
} from '../db/schema.js';
import { crudRoutes } from '../core/crud.js';
import { requireWrite } from '../core/auth.js';
import { notFound } from '../core/errors.js';

export function contactRoutes(app: FastifyInstance): void {
  crudRoutes(app, '/api/v1/contacts', {
    table: contacts, entityType: 'contact', label: 'Contact',
    create: z.object({
      name: z.string().trim().min(1),
      type: z.enum(CONTACT_TYPES).default('vendor'),
      phones: z.array(z.object({ label: z.string(), number: z.string() })).nullable().optional(),
      email: z.string().email().nullable().optional(),
      website: z.string().nullable().optional(),
      address: z.record(z.string()).nullable().optional(),
      notesMd: z.string().nullable().optional(),
      rating: z.number().int().min(1).max(5).nullable().optional(),
      preferred: z.boolean().optional(),
      specialties: z.array(z.string()).nullable().optional(),
    }),
    update: z.object({
      name: z.string().trim().min(1).optional(),
      type: z.enum(CONTACT_TYPES).optional(),
      phones: z.array(z.object({ label: z.string(), number: z.string() })).nullable().optional(),
      email: z.string().email().nullable().optional(),
      website: z.string().nullable().optional(),
      address: z.record(z.string()).nullable().optional(),
      notesMd: z.string().nullable().optional(),
      rating: z.number().int().min(1).max(5).nullable().optional(),
      preferred: z.boolean().optional(),
      specialties: z.array(z.string()).nullable().optional(),
    }),
    searchColumns: ['name', 'email', 'notesMd'],
    filterColumns: ['type', 'preferred'],
    sortColumns: ['name', 'rating', 'createdAt'],
  });

  /** "Who did the plumbing last time, and were they any good?" (CONT-003) */
  app.get('/api/v1/contacts/:id/history', async (req) => {
    const id = (req.params as { id: string }).id;
    const contact = (await req.ctx.db.select().from(contacts).where(eq(contacts.id, id)).limit(1))[0];
    if (!contact) throw notFound('Contact');

    const linkedPayees = await req.ctx.db.select({ id: payees.id }).from(payees)
      .where(and(eq(payees.contactId, id), isNull(payees.deletedAt)));
    const payeeIds = linkedPayees.map((p) => p.id);

    const [jobs, quoteRows, visits, loanRows, spendRows] = await Promise.all([
      req.ctx.db.select().from(maintenanceRecords).where(and(
        eq(maintenanceRecords.performerContactId, id), isNull(maintenanceRecords.deletedAt),
      )).orderBy(desc(maintenanceRecords.performedAt)).limit(100),
      req.ctx.db.select().from(quotes).where(and(eq(quotes.contactId, id), isNull(quotes.deletedAt)))
        .orderBy(desc(quotes.quotedAt)).limit(50),
      req.ctx.db.select().from(petVisits).where(and(
        eq(petVisits.providerContactId, id), isNull(petVisits.deletedAt),
      )).orderBy(desc(petVisits.visitedAt)).limit(50),
      req.ctx.db.select().from(loans).where(and(eq(loans.contactId, id), isNull(loans.deletedAt)))
        .orderBy(desc(loans.lentAt)).limit(50),
      payeeIds.length
        ? req.ctx.db.select({
          total: sql<number>`coalesce(sum(${transactions.amount}), 0)`,
          count: sql<number>`count(*)`,
        }).from(transactions).where(and(
          inArray(transactions.payeeId, payeeIds),
          eq(transactions.type, 'expense'), isNull(transactions.deletedAt),
        ))
        : Promise.resolve([{ total: 0, count: 0 }]),
    ]);

    return {
      contact,
      jobs, quotes: quoteRows, visits, loans: loanRows,
      spend: {
        total: Number(spendRows[0]?.total ?? 0),
        count: Number(spendRows[0]?.count ?? 0),
        currency: req.ctx.household.currency,
      },
      openLoans: loanRows.filter((l) => !l.returnedAt).length,
    };
  });

  crudRoutes(app, '/api/v1/service-accounts', {
    table: serviceAccounts, entityType: 'contact', label: 'Service account',
    create: z.object({
      contactId: z.string().min(1),
      kind: z.string().trim().min(1),
      accountNumberEnc: z.string().nullable().optional(),
      emergencyPhone: z.string().nullable().optional(),
      recurringBillId: z.string().nullable().optional(),
    }),
    update: z.object({
      kind: z.string().trim().min(1).optional(),
      accountNumberEnc: z.string().nullable().optional(),
      emergencyPhone: z.string().nullable().optional(),
      recurringBillId: z.string().nullable().optional(),
    }),
    filterColumns: ['contactId', 'kind'],
  });

  app.post('/api/v1/contacts/:id/rate', async (req) => {
    requireWrite(req.ctx.user);
    const id = (req.params as { id: string }).id;
    const body = z.object({
      rating: z.number().int().min(1).max(5), comment: z.string().optional(),
    }).parse(req.body);
    const contact = (await req.ctx.db.select().from(contacts).where(eq(contacts.id, id)).limit(1))[0];
    if (!contact) throw notFound('Contact');
    const notes = body.comment
      ? [contact.notesMd, `${req.ctx.today}: ${'★'.repeat(body.rating)} ${body.comment}`].filter(Boolean).join('\n')
      : contact.notesMd;
    const [row] = await req.ctx.db.update(contacts)
      .set({ rating: body.rating, notesMd: notes, updatedBy: req.ctx.user!.id })
      .where(eq(contacts.id, id)).returning();
    return row;
  });
}
