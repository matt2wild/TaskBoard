import { describe, it, expect, afterEach } from 'vitest';
import { makeHarness, makeHome, shift, today, type Harness } from './helpers.js';

let h: Harness;
afterEach(async () => { await h?.close(); });

const period = () => today().slice(0, 7);

async function categoryNamed(harness: Harness, name: string): Promise<string> {
  const res = await harness.api('GET', `/api/v1/categories?q=${encodeURIComponent(name)}`);
  const hit = res.items.find((c: any) => c.name === name);
  if (!hit) throw new Error(`no category ${name}`);
  return hit.id;
}

describe('budgeting', () => {
  it('ships a usable category tree', async () => {
    h = await makeHarness();
    const res = await h.api('GET', '/api/v1/categories?limit=200');
    const names = res.items.map((c: any) => c.name);
    expect(names).toContain('Groceries');
    expect(names).toContain('Maintenance');
    expect(names).toContain('Vet');
  });

  it('splits a transaction and refuses one that does not balance', async () => {
    h = await makeHarness();
    const groceries = await categoryNamed(h, 'Groceries');
    const petFood = await categoryNamed(h, 'Pet food');

    const tx = await h.api('POST', '/api/v1/transactions', {
      amount: 9640, payeeName: 'Shaws', memo: 'Weekly shop',
      splits: [
        { amount: 7140, categoryId: groceries },
        { amount: 2500, categoryId: petFood },
      ],
    });
    expect(tx.splits).toHaveLength(2);

    const bad = await h.status('POST', '/api/v1/transactions', {
      amount: 1000, splits: [{ amount: 400 }, { amount: 500 }],
    });
    expect(bad).toBe(400);
  });

  it('accepts money as a typed string and stores integer cents', async () => {
    h = await makeHarness();
    const tx = await h.api('POST', '/api/v1/transactions', { amount: '$1,234.50', payeeName: 'Someone' });
    expect(tx.amount).toBe(123450);
  });

  it('attributes spend to the thing it was for and reports it back', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const asset = await h.api('POST', '/api/v1/assets', { propertyId: home.propertyId, name: 'Water heater' });
    const maintenance = await categoryNamed(h, 'Maintenance');

    await h.api('POST', '/api/v1/transactions', {
      amount: 18500, categoryId: maintenance, payeeName: 'Valley Heating',
      memo: 'Annual service', attributions: [{ entityType: 'asset', entityId: asset.id }],
    });

    const report = await h.api('GET', '/api/v1/budget/reports/by-attribution');
    expect(report.items[0]).toMatchObject({ entityType: 'asset', label: 'Water heater', total: 18500 });

    const filtered = await h.api('GET', `/api/v1/transactions?entityType=asset&entityId=${asset.id}`);
    expect(filtered.items).toHaveLength(1);
  });

  it('tracks a monthly budget against actuals with rollover', async () => {
    h = await makeHarness();
    const groceries = await categoryNamed(h, 'Groceries');
    const p = period();
    await h.api('PUT', `/api/v1/budget/${p}/allocations`, {
      allocations: [{ categoryId: groceries, amount: 70000 }],
    });
    await h.api('POST', '/api/v1/transactions', {
      amount: 22000, categoryId: groceries, date: `${p}-02`, payeeName: 'Shaws',
    });
    const budget = await h.api('GET', `/api/v1/budget/${p}`);
    const line = budget.categories.find((c: any) => c.categoryId === groceries);
    expect(line).toMatchObject({ allocated: 70000, spent: 22000, remaining: 48000, pct: 31 });
  });

  it('copies last month with an adjustment', async () => {
    h = await makeHarness();
    const groceries = await categoryNamed(h, 'Groceries');
    await h.api('PUT', '/api/v1/budget/2026-01/allocations', {
      allocations: [{ categoryId: groceries, amount: 100000 }],
    });
    await h.api('POST', '/api/v1/budget/2026-02/copy-from/2026-01', { adjustPct: 3 });
    const next = await h.api('GET', '/api/v1/budget/2026-02');
    expect(next.categories.find((c: any) => c.categoryId === groceries).allocated).toBe(103000);
  });

  it('imports a bank CSV and refuses the same rows twice', async () => {
    h = await makeHarness();
    const account = await h.api('POST', '/api/v1/accounts', { name: 'Joint checking', type: 'checking' });
    const csv = [
      'Date,Description,Amount',
      '01/15/2026,AUBUCHON HARDWARE,-38.00',
      '01/16/2026,SHAWS #412,-96.40',
      '01/31/2026,PAYROLL,2400.00',
    ].join('\n');

    const preview = await h.api('POST', '/api/v1/transactions/import/preview', {
      csv, mapping: { date: 'Date', amount: 'Amount', payee: 'Description' },
      dateFormat: 'us', accountId: account.id,
    });
    expect(preview.total).toBe(3);
    expect(preview.rows[0]).toMatchObject({ date: '2026-01-15', amount: 3800, type: 'expense' });
    expect(preview.rows[2]).toMatchObject({ type: 'income', amount: 240000 });
    expect(preview.duplicates).toBe(0);

    const committed = await h.api('POST', '/api/v1/transactions/import/commit', {
      accountId: account.id, rows: preview.rows,
    });
    expect(committed).toMatchObject({ imported: 3, skipped: 0 });

    const second = await h.api('POST', '/api/v1/transactions/import/preview', {
      csv, mapping: { date: 'Date', amount: 'Amount', payee: 'Description' },
      dateFormat: 'us', accountId: account.id,
    });
    expect(second.duplicates).toBe(3);
    const again = await h.api('POST', '/api/v1/transactions/import/commit', {
      accountId: account.id, rows: second.rows,
    });
    expect(again).toMatchObject({ imported: 0, skipped: 3 });
  });

  it('handles quoted CSV fields with commas', async () => {
    h = await makeHarness();
    const csv = 'Date,Description,Amount\n2026-02-01,"SHAWS, NORTHFIELD",-12.00';
    const preview = await h.api('POST', '/api/v1/transactions/import/preview', {
      csv, mapping: { date: 'Date', amount: 'Amount', payee: 'Description' },
    });
    expect(preview.rows[0].payee).toBe('SHAWS, NORTHFIELD');
  });

  it('derives an account balance from its transactions', async () => {
    h = await makeHarness();
    const account = await h.api('POST', '/api/v1/accounts', {
      name: 'Checking', type: 'checking', openingBalance: 100000,
    });
    await h.api('POST', '/api/v1/transactions', { amount: 25000, accountId: account.id, payeeName: 'Rent' });
    await h.api('POST', '/api/v1/transactions', { amount: 5000, type: 'income', accountId: account.id, payeeName: 'Refund' });
    const list = await h.api('GET', '/api/v1/accounts');
    expect(list.items[0].balance).toBe(100000 - 25000 + 5000);
  });

  it('pays a recurring bill from its task and reschedules it', async () => {
    h = await makeHarness();
    const electricity = await categoryNamed(h, 'Electricity');
    const bill = await h.api('POST', '/api/v1/bills', {
      name: 'Electricity', categoryId: electricity, amount: 16000, variable: true, leadDays: 5,
    });
    await h.api('POST', `/api/v1/bills/${bill.id}/schedule`, { dayOfMonth: 18, startDate: shift(-40) });

    const tasks = await h.api('GET', `/api/v1/tasks?originType=bill&originId=${bill.id}&sort=dueDate`);
    expect(tasks.items.length).toBeGreaterThan(0);

    const res = await h.api('POST', `/api/v1/tasks/${tasks.items[0].id}/complete`, {
      extra: { amount: 16240 },
    });
    expect(res.result.transactionId).toBeTruthy();
    expect(res.result.amount).toBe(16240);

    const txs = await h.api('GET', '/api/v1/transactions');
    expect(txs.items[0].memo).toBe('Electricity');
  });

  it('plans years ahead from asset life, project ideas and goals', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const thisYear = Number(today().slice(0, 4));
    await h.api('POST', '/api/v1/assets', {
      propertyId: home.propertyId, name: 'Roof',
      installedDate: `${thisYear - 24}-08-01`, expectedLifespanYears: 25, replacementCostEstimate: 1400000,
    });
    await h.api('POST', '/api/v1/projects', {
      propertyId: home.propertyId, name: 'Replace the deck', status: 'idea',
      estimateCost: 900000, targetStart: `${thisYear + 2}-05-01`,
    });
    await h.api('POST', '/api/v1/goals', { name: 'New roof fund', targetAmount: 1400000, targetDate: `${thisYear + 1}-01-01` });

    const plan = await h.api('GET', '/api/v1/budget/long-range?years=10');
    const kinds = plan.years.flatMap((y: any) => y.items.map((i: any) => i.kind));
    expect(kinds).toContain('asset_replacement');
    expect(kinds).toContain('project');
    expect(kinds).toContain('goal');
    const roofYear = plan.years.find((y: any) => y.items.some((i: any) => i.label === 'Roof'));
    expect(roofYear.year).toBe(thisYear + 1);
  });

  it('will not delete a category that transactions use', async () => {
    h = await makeHarness();
    const groceries = await categoryNamed(h, 'Groceries');
    await h.api('POST', '/api/v1/transactions', { amount: 1000, categoryId: groceries, payeeName: 'Shop' });
    const code = await h.status('DELETE', `/api/v1/categories/${groceries}`);
    expect(code).toBe(400);
  });

  it('merges duplicate payees and keeps their transactions', async () => {
    h = await makeHarness();
    await h.api('POST', '/api/v1/transactions', { amount: 1000, payeeName: 'Shaws' });
    await h.api('POST', '/api/v1/transactions', { amount: 2000, payeeName: 'SHAWS #412' });
    const payees = await h.api('GET', '/api/v1/payees');
    const keep = payees.items.find((p: any) => p.name === 'Shaws');
    const merge = payees.items.find((p: any) => p.name === 'SHAWS #412');

    await h.api('POST', '/api/v1/payees/merge', { keepId: keep.id, mergeIds: [merge.id] });
    const txs = await h.api('GET', `/api/v1/transactions?payeeId=${keep.id}`);
    expect(txs.items).toHaveLength(2);
  });
});
