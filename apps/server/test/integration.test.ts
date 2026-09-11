import { describe, it, expect, afterEach } from 'vitest';
import { makeHarness, makeHome, shift, today, type Harness } from './helpers.js';

let h: Harness;
afterEach(async () => { await h?.close(); });

/** The journeys from the requirements, run end to end. */

describe('C.1 furnace filter: maintenance, pantry and budget move together', () => {
  it('completes the plan, takes the filter off the shelf, books the cost and reschedules', async () => {
    h = await makeHarness();
    const home = await makeHome(h);

    const asset = await h.api('POST', '/api/v1/assets', {
      propertyId: home.propertyId, locationId: home.roomId, name: 'Furnace',
      installedDate: shift(-2000), purchasePrice: 480000, expectedLifespanYears: 20,
    });
    const filter = await h.api('POST', '/api/v1/products', {
      name: 'Furnace filter 16x25x1', isFood: false, defaultUnit: 'ea', minQuantity: 2,
    });
    await h.api('POST', '/api/v1/stock', { productId: filter.id, quantity: 2, locationId: home.roomId });

    const plan = await h.api('POST', '/api/v1/maintenance/plans/full', {
      plan: { targetType: 'asset', targetId: asset.id, title: 'Replace air filter', estimateMin: 10 },
      schedule: { mode: 'floating', every: { days: 90 }, anchorDate: shift(-90) },
      consumables: [{ productId: filter.id, quantity: 1, unit: 'ea' }],
    });
    expect(plan.nextDue).toBe(shift(-90));

    const readiness = await h.api('GET', `/api/v1/maintenance/plans/${plan.id}/readiness`);
    expect(readiness.consumables[0]).toMatchObject({ needed: 1, onHand: 2, enough: true });

    const tasks = await h.api('GET', `/api/v1/tasks?originType=maintenance&originId=${plan.id}`);
    expect(tasks.items).toHaveLength(1);

    const result = await h.api('POST', `/api/v1/tasks/${tasks.items[0].id}/complete`, {
      extra: { cost: { amount: 3800, payeeName: 'Aubuchon Hardware' } },
    });

    // Floating: 90 days from today, not from the date it was nominally due.
    expect(result.next).toBe(shift(90));
    expect(result.result.record.title).toBe('Replace air filter');
    expect(result.result.stock[0].consumed).toBe(1);
    expect(result.result.transactionId).toBeTruthy();

    const product = await h.api('GET', `/api/v1/products/${filter.id}`);
    expect(product.onHand).toBe(1);
    expect(product.isLow).toBe(true);

    // Cost of ownership now carries the filter purchase.
    const after = await h.api('GET', `/api/v1/assets/${asset.id}`);
    expect(after.totalCost).toBe(480000 + 3800);
    expect(after.maintenanceSpend).toBe(3800);

    // Falling below par puts exactly one line on the shopping list.
    const lists = await h.api('GET', '/api/v1/shopping-lists');
    const lines = await h.api('GET', `/api/v1/shopping-lists/${lists.items[0].id}/lines`);
    const filterLines = lines.open.filter((l: any) => l.productId === filter.id);
    expect(filterLines).toHaveLength(1);

    // And the history is on the asset timeline.
    const timeline = await h.api('GET', `/api/v1/assets/${asset.id}/timeline`);
    expect(timeline.records).toHaveLength(1);
    expect(timeline.spend.total).toBe(3800);
  });

  it('reports a shortfall instead of pretending the shelf was full', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const asset = await h.api('POST', '/api/v1/assets', {
      propertyId: home.propertyId, name: 'Furnace',
    });
    const filter = await h.api('POST', '/api/v1/products', { name: 'Filter', isFood: false });
    await h.api('POST', '/api/v1/stock', { productId: filter.id, quantity: 0.5 });

    const res = await h.api('POST', '/api/v1/maintenance/log', {
      targetType: 'asset', targetId: asset.id, title: 'Replace filter',
      consumables: [{ productId: filter.id, quantity: 1 }],
    });
    expect(res.stock[0].consumed).toBe(0.5);
    expect(res.stock[0].shortfall).toBe(0.5);
    expect(res.shoppingAdded).toContain('Filter');
  });
});

describe('C.5 grocery run: shopping, put-away, stock and one transaction', () => {
  it('turns a finished trip into stock, a receipt and price history', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const milk = await h.api('POST', '/api/v1/products', {
      name: 'Oat milk', defaultUnit: 'bottle', minQuantity: 2,
      shelfLife: { ambient: 180, refrigerated: 10 },
    });
    const beans = await h.api('POST', '/api/v1/products', {
      name: 'Black beans', defaultUnit: 'can', minQuantity: 4, shelfLife: { ambient: 400 },
    });

    const list = await h.api('POST', '/api/v1/shopping-lists', { name: 'Grocery', isDefault: true });
    const l1 = await h.api('POST', `/api/v1/shopping-lists/${list.id}/lines`, { productId: milk.id, quantity: 2 });
    const l2 = await h.api('POST', `/api/v1/shopping-lists/${list.id}/lines`, { productId: beans.id, quantity: 4 });

    const res = await h.api('POST', `/api/v1/shopping-lists/${list.id}/put-away`, {
      items: [
        { lineId: l1.id, quantity: 2, locationId: home.pantryId, unitPrice: 449 },
        { lineId: l2.id, quantity: 4, locationId: home.pantryId, unitPrice: 129 },
      ],
      transaction: { total: 1414, payeeName: 'Shaws', memo: 'Weekly shop' },
    });
    expect(res.stockItems).toHaveLength(2);
    expect(res.transactionId).toBeTruthy();

    const stock = await h.api('GET', `/api/v1/stock?productId=${milk.id}`);
    expect(stock.items[0].quantity).toBe(2);
    // Expiry came from the product's shelf life for an ambient area.
    expect(stock.items[0].expiryDate).toBe(shift(180));

    const prices = await h.api('GET', `/api/v1/products/${milk.id}/prices`);
    expect(prices.last).toBe(449);
    expect(prices.items[0].vendor).toBe('Shaws');

    const open = await h.api('GET', `/api/v1/shopping-lists/${list.id}/lines`);
    expect(open.open).toHaveLength(0);
  });

  it('drains the soonest-expiring lot first', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const yogurt = await h.api('POST', '/api/v1/products', { name: 'Yogurt', defaultUnit: 'ea' });
    await h.api('POST', '/api/v1/stock', {
      productId: yogurt.id, quantity: 3, locationId: home.pantryId, expiryDate: shift(30),
    });
    await h.api('POST', '/api/v1/stock', {
      productId: yogurt.id, quantity: 3, locationId: home.pantryId, expiryDate: shift(2),
    });

    await h.api('POST', '/api/v1/stock/consume', { productId: yogurt.id, quantity: 4 });

    // The near-expiry lot is emptied first and drops out of the pantry view;
    // the remainder comes off the later lot.
    const stock = await h.api('GET', `/api/v1/stock?productId=${yogurt.id}`);
    expect(stock.items).toHaveLength(1);
    expect(stock.items[0]).toMatchObject({ expiryDate: shift(30), quantity: 2 });
    const product = await h.api('GET', `/api/v1/products/${yogurt.id}`);
    expect(product.onHand).toBe(2);
  });

  it('shortens the expiry when a lot is opened', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const milk = await h.api('POST', '/api/v1/products', {
      name: 'Milk', defaultUnit: 'bottle', useWithinDaysOpened: 5,
    });
    const lot = await h.api('POST', '/api/v1/stock', {
      productId: milk.id, quantity: 1, locationId: home.pantryId, expiryDate: shift(40),
    });
    const res = await h.api('POST', `/api/v1/stock/${lot.id}/adjust`, { action: 'open' });
    expect(res.stockItem.expiryDate).toBe(shift(5));
    expect(res.stockItem.openedAt).toBe(today());
  });

  it('records waste with its cost', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const p = await h.api('POST', '/api/v1/products', { name: 'Spinach', defaultUnit: 'bag' });
    const lot = await h.api('POST', '/api/v1/stock', {
      productId: p.id, quantity: 2, locationId: home.pantryId, unitPrice: 399,
    });
    await h.api('POST', `/api/v1/stock/${lot.id}/adjust`, {
      action: 'waste', quantity: 2, wasteReason: 'spoiled',
    });
    const waste = await h.api('GET', '/api/v1/food/waste');
    expect(waste.items).toHaveLength(1);
    expect(waste.totalCost).toBe(798);
  });

  it('answers whether a recipe can be made and adds what is missing', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const beans = await h.api('POST', '/api/v1/products', { name: 'Black beans', defaultUnit: 'can' });
    const rice = await h.api('POST', '/api/v1/products', { name: 'Rice', defaultUnit: 'box' });
    await h.api('POST', '/api/v1/stock', { productId: beans.id, quantity: 3, locationId: home.pantryId });

    const recipe = await h.api('POST', '/api/v1/recipes', { name: 'Beans and rice', servings: 4 });
    await h.api('PUT', `/api/v1/recipes/${recipe.id}/ingredients`, {
      items: [
        { productId: beans.id, text: 'Black beans', quantity: 2, unit: 'can' },
        { productId: rice.id, text: 'Rice', quantity: 1, unit: 'box' },
      ],
    });

    const avail = await h.api('GET', `/api/v1/recipes/${recipe.id}/availability`);
    expect(avail.canMake).toBe(false);
    expect(avail.missing.map((m: any) => m.text)).toEqual(['Rice']);

    await h.api('POST', `/api/v1/recipes/${recipe.id}/add-missing`);
    const lists = await h.api('GET', '/api/v1/shopping-lists');
    const lines = await h.api('GET', `/api/v1/shopping-lists/${lists.items[0].id}/lines`);
    expect(lines.open.map((l: any) => l.text)).toContain('Rice');

    await h.api('POST', '/api/v1/stock', { productId: rice.id, quantity: 2, locationId: home.pantryId });
    const again = await h.api('GET', `/api/v1/recipes/${recipe.id}/availability`);
    expect(again.canMake).toBe(true);

    await h.api('POST', `/api/v1/recipes/${recipe.id}/cook`);
    const beansNow = await h.api('GET', `/api/v1/products/${beans.id}`);
    expect(beansNow.onHand).toBe(1);
  });
});

describe('C.4 where are the Christmas lights', () => {
  it('finds a stored item and shows the path to it', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const shelf = await h.api('POST', '/api/v1/locations', {
      propertyId: home.propertyId, parentId: home.garageId, name: 'Shelf 3', type: 'shelf',
    });
    const tote = await h.api('POST', '/api/v1/locations', {
      propertyId: home.propertyId, parentId: shelf.id, name: 'Tote 7', type: 'container',
    });
    await h.api('POST', '/api/v1/storage-items', { name: 'Christmas lights', locationId: tote.id, quantity: 3 });

    const found = await h.api('GET', '/api/v1/search?q=christmas');
    expect(found.items[0].label).toBe('Christmas lights');
    expect(found.items[0].sub).toBe('Garage › Shelf 3 › Tote 7');

    const contents = await h.api('GET', `/api/v1/locations/${tote.id}/contents`);
    expect(contents.storageItems).toHaveLength(1);
    expect(contents.path).toBe('Garage › Shelf 3 › Tote 7');
  });

  it('resolves a scanned QR label to the thing it is stuck to', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const made = await h.api('POST', '/api/v1/labels', {
      count: 1, entityType: 'location', entityId: home.garageId,
    });
    const resolved = await h.api('GET', `/api/v1/labels/resolve/${made.codes[0]}`);
    expect(resolved.assigned).toBe(true);
    expect(resolved.label).toBe('Garage');
  });

  it('refuses to nest a location inside itself', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const child = await h.api('POST', '/api/v1/locations', {
      propertyId: home.propertyId, parentId: home.garageId, name: 'Shelf', type: 'shelf',
    });
    const code = await h.status('PATCH', `/api/v1/locations/${home.garageId}`, { parentId: child.id });
    expect(code).toBe(400);
  });
});

describe('tools and loans', () => {
  it('tracks a tool out on loan and brings it back with a task', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const tool = await h.api('POST', '/api/v1/tools', {
      propertyId: home.propertyId, locationId: home.garageId, name: 'Oscillating multi-tool',
    });
    const dave = await h.api('POST', '/api/v1/contacts', { name: 'Dave next door', type: 'person' });

    const loan = await h.api('POST', '/api/v1/loans', {
      itemType: 'asset', itemId: tool.id, contactId: dave.id, dueBack: shift(-2),
    });
    expect(loan.taskId).toBeTruthy();

    const availability = await h.api('POST', '/api/v1/tools/availability', { assetIds: [tool.id] });
    expect(availability.items[0]).toMatchObject({ available: false, status: 'loaned_out' });
    expect(availability.items[0].blockedBy).toContain('Dave');

    const open = await h.api('GET', '/api/v1/loans?open=true');
    expect(open.items[0].overdue).toBe(true);
    expect(open.items[0].item).toBe('Oscillating multi-tool');

    await h.api('POST', `/api/v1/loans/${loan.id}/return`, { condition: 'good' });
    const after = await h.api('POST', '/api/v1/tools/availability', { assetIds: [tool.id] });
    expect(after.items[0].available).toBe(true);
    const task = await h.api('GET', `/api/v1/tasks/${loan.taskId}`);
    expect(task.status).toBe('done');
  });

  it('refuses to lend the same thing twice', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const tool = await h.api('POST', '/api/v1/tools', { propertyId: home.propertyId, name: 'Ladder' });
    await h.api('POST', '/api/v1/loans', { itemType: 'asset', itemId: tool.id, contactName: 'Dave' });
    const code = await h.status('POST', '/api/v1/loans', {
      itemType: 'asset', itemId: tool.id, contactName: 'Someone else',
    });
    expect(code).toBe(400);
  });

  it('shows what a tool eats and whether it is in stock', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    const saw = await h.api('POST', '/api/v1/tools', { propertyId: home.propertyId, name: 'Circular saw' });
    const blade = await h.api('POST', '/api/v1/products', {
      name: '7-1/4" 24T blade', isFood: false, defaultUnit: 'ea', minQuantity: 2,
    });
    await h.api('POST', `/api/v1/tools/${saw.id}/consumables`, {
      description: '7-1/4" framing blade', productIds: [blade.id],
    });
    const list = await h.api('GET', `/api/v1/tools/${saw.id}/consumables`);
    expect(list.items[0].products[0]).toMatchObject({ name: '7-1/4" 24T blade', onHand: 0, isLow: true });
  });

  it('keeps tools out of the assets list and assets out of the tools list', async () => {
    h = await makeHarness();
    const home = await makeHome(h);
    await h.api('POST', '/api/v1/assets', { propertyId: home.propertyId, name: 'Furnace' });
    await h.api('POST', '/api/v1/tools', { propertyId: home.propertyId, name: 'Drill' });

    const assets = await h.api('GET', '/api/v1/assets');
    const tools = await h.api('GET', '/api/v1/tools');
    expect(assets.items.map((a: any) => a.name)).toEqual(['Furnace']);
    expect(tools.items.map((t: any) => t.name)).toEqual(['Drill']);
  });
});
