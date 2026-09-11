/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq } from 'drizzle-orm';
import { addDays, addMonths } from '@homestead/shared';
import type { DB } from '../db/index.js';
import { makeCtx, invalidateHousehold } from '../core/ctx.js';
import { hashPassword } from '../core/auth.js';
import * as s from '../db/schema.js';
import { seedDefaults } from './defaults.js';
import { upsertSchedule, materialiseAll } from '../services/tasks.js';
import { addStock } from '../services/stock.js';
import { attachCost } from '../services/budget.js';
import { materialiseDoses, recordDailyPetFood } from '../services/pets.js';
import { recordActivity } from '../services/carbon.js';
import { estimateIntervention } from '../services/interventions.js';
import { registerMaintenanceHooks } from '../services/maintenance.js';
import { registerPetHooks } from '../services/pets.js';

/**
 * A household with a real shape: a house with systems that need looking after,
 * a pantry that runs down, a remodel in flight, tools that go missing, and a
 * cat on medication. It exists so the app can be evaluated in one command
 * (OPS-031) and so the journeys in the requirements have something to run on.
 */
export async function seedDemo(db: DB, opts: { password?: string } = {}): Promise<{
  users: Array<{ username: string; password: string }>;
  counts: Record<string, number>;
}> {
  registerMaintenanceHooks();
  registerPetHooks();

  const [household] = await db.insert(s.households).values({
    name: 'Wild House', timezone: 'America/New_York', currency: 'USD', unitSystem: 'imperial',
  }).returning();
  invalidateHousehold();

  const password = opts.password ?? 'homestead';
  const [admin] = await db.insert(s.users).values({
    displayName: 'Matt', username: 'matt', email: 'matt@example.com',
    passwordHash: await hashPassword(password), role: 'admin',
  }).returning();
  const [partner] = await db.insert(s.users).values({
    displayName: 'Alex', username: 'alex', email: 'alex@example.com',
    passwordHash: await hashPassword(password), role: 'member',
  }).returning();
  const [sitter] = await db.insert(s.users).values({
    displayName: 'Sam (sitter)', username: 'sam', email: 'sam@example.com',
    passwordHash: await hashPassword(password), role: 'limited',
  }).returning();

  await seedDefaults(db);
  const ctx = await makeCtx(db, {
    id: admin!.id, role: 'admin', displayName: 'Matt', username: 'matt',
    email: 'matt@example.com', scope: 'write',
  });
  const today = ctx.today;

  /* ── the house and its rooms ── */

  const [property] = await db.insert(s.properties).values({
    name: 'Home', type: 'house', isPrimary: true,
    address: { line1: '14 Alder Lane', city: 'Northfield', region: 'VT', postcode: '05663' },
    purchaseDate: '2019-06-14', purchasePrice: 31500000, areaSqft: 1840, yearBuilt: 1978,
    notesMd: 'Two-storey colonial. Well and septic. Oil-fired forced air, 275 gallon tank in the basement.',
    createdBy: admin!.id,
  }).returning();

  const loc = async (name: string, type: string, parentId: string | null, extra: Record<string, unknown> = {}) => {
    const [row] = await db.insert(s.locations).values({
      propertyId: property!.id, parentId, name, type, createdBy: admin!.id, ...extra,
    }).returning();
    return row!;
  };

  const main = await loc('Main floor', 'floor', null);
  const upstairs = await loc('Upstairs', 'floor', null);
  const basement = await loc('Basement', 'floor', null);
  const outside = await loc('Outside', 'exterior', null);

  const kitchen = await loc('Kitchen', 'room', main.id);
  const livingRoom = await loc('Living room', 'room', main.id);
  const mudroom = await loc('Mudroom', 'room', main.id);
  const mainBath = await loc('Main bathroom', 'room', upstairs.id);
  const bedroom = await loc('Primary bedroom', 'room', upstairs.id);
  const utility = await loc('Utility room', 'room', basement.id);
  const garage = await loc('Garage', 'room', main.id);

  const pantry = await loc('Pantry', 'zone', kitchen.id, { holdsFood: true, temperatureClass: 'ambient', shortCode: 'PANTRY' });
  const fridge = await loc('Fridge', 'zone', kitchen.id, { holdsFood: true, temperatureClass: 'refrigerated', shortCode: 'FRIDGE' });
  const freezer = await loc('Chest freezer', 'zone', basement.id, { holdsFood: true, temperatureClass: 'frozen', shortCode: 'FREEZER' });
  const shelf3 = await loc('Shelf 3', 'shelf', garage.id, { shortCode: 'GAR-S3' });
  const bin12 = await loc('Bin 12', 'container', shelf3.id, { shortCode: 'B12' });
  const tote7 = await loc('Tote 7', 'container', shelf3.id, { shortCode: 'T7' });
  const pegboard = await loc('Pegboard', 'zone', garage.id, { shortCode: 'PEG' });
  const toolCabinet = await loc('Tool cabinet', 'container', garage.id, { shortCode: 'TC1' });

  const catSlug = async (slug: string) => {
    const rows = await db.select().from(s.assetCategories).where(eq(s.assetCategories.slug, slug)).limit(1);
    return rows[0]?.id ?? null;
  };

  /* ── contacts ── */

  const contact = async (name: string, type: string, extra: Record<string, unknown> = {}) => {
    const [row] = await db.insert(s.contacts).values({ name, type, createdBy: admin!.id, ...extra }).returning();
    return row!;
  };
  const plumber = await contact('Ridgeline Plumbing', 'contractor', {
    phones: [{ label: 'office', number: '802-555-0142' }], specialties: ['plumbing'], rating: 4, preferred: true,
  });
  const plumberB = await contact('Green Mountain Mechanical', 'contractor', {
    phones: [{ label: 'office', number: '802-555-0177' }], specialties: ['plumbing', 'hvac'], rating: 3,
  });
  const hvacCo = await contact('Valley Heating & Cooling', 'contractor', { specialties: ['hvac'], rating: 5, preferred: true });
  const vet = await contact('Northfield Animal Hospital', 'vet', {
    phones: [{ label: 'clinic', number: '802-555-0188' }], email: 'care@northfieldvet.example',
  });
  const emergencyVet = await contact('Green Mountain Emergency Vet', 'vet', {
    phones: [{ label: '24h', number: '802-555-0911' }],
  });
  const hardware = await contact('Aubuchon Hardware', 'vendor', {});
  const grocer = await contact('Shaw’s', 'vendor', {});
  const insurer = await contact('Trupanion', 'insurer', {});
  const neighbour = await contact('Dave next door', 'person', {});

  /* ── assets ── */

  const asset = async (name: string, slug: string, locationId: string, extra: Record<string, unknown> = {}) => {
    const [row] = await db.insert(s.assets).values({
      propertyId: property!.id, locationId, name, categoryId: await catSlug(slug),
      createdBy: admin!.id, updatedBy: admin!.id, ...extra,
    }).returning();
    return row!;
  };

  const furnace = await asset('Oil furnace', 'furnace', utility.id, {
    make: 'Weil-McLain', model: 'WTGO-3', serial: 'WM-884213',
    installedDate: '2019-09-02', purchasePrice: 480000, expectedLifespanYears: 20,
    replacementCostEstimate: 620000, warrantyExpiry: addDays(today, 41),
    notesMd: 'Filter size 16x25x1. Return is in the hallway ceiling.',
  });
  const waterHeater = await asset('Water heater', 'water-heater', utility.id, {
    make: 'Rheem', model: 'XE50T10H', installedDate: '2021-03-15',
    purchasePrice: 128000, expectedLifespanYears: 12, warrantyExpiry: '2031-03-15',
  });
  const fridgeAsset = await asset('Refrigerator', 'refrigerator', kitchen.id, {
    make: 'LG', model: 'LRFVS3006S', purchaseDate: '2020-11-20',
    purchasePrice: 219900, expectedLifespanYears: 14,
  });
  const sumpPump = await asset('Sump pump', 'sump-pump', basement.id, {
    make: 'Zoeller', model: 'M53', installedDate: '2022-05-01', purchasePrice: 21000, expectedLifespanYears: 8,
  });
  const roof = await asset('Roof', 'roof', outside.id, {
    installedDate: '2009-08-01', expectedLifespanYears: 25, replacementCostEstimate: 1400000,
    notesMd: 'Architectural asphalt shingle. South slope has moss at the north-east valley.',
  });
  const mower = await asset('Lawn mower', 'lawn-mower', garage.id, {
    make: 'Honda', model: 'HRX217', purchaseDate: '2021-05-04', purchasePrice: 69900, expectedLifespanYears: 10,
  });
  const smoke = await asset('Smoke detectors', 'smoke-detector', upstairs.id, {
    installedDate: '2019-06-20', expectedLifespanYears: 10, notesMd: 'Five units: three up, two down.',
  });

  await db.insert(s.warranties).values([
    { assetId: furnace.id, type: 'manufacturer', startDate: '2019-09-02', endDate: addDays(today, 41),
      coverageMd: 'Parts, 10 years, registered.', providerContactId: hvacCo.id, createdBy: admin!.id },
    { assetId: waterHeater.id, type: 'manufacturer', startDate: '2021-03-15', endDate: '2031-03-15', createdBy: admin!.id },
  ]);

  /* ── products, pantry and consumables ── */

  const prodCat = async (slug: string) => {
    const rows = await db.select().from(s.productCategories).where(eq(s.productCategories.slug, slug)).limit(1);
    return rows[0]?.id ?? null;
  };

  const product = async (name: string, extra: Record<string, unknown> = {}) => {
    const [row] = await db.insert(s.products).values({ name, createdBy: admin!.id, updatedBy: admin!.id, ...extra }).returning();
    return row!;
  };

  const filter = await product('Furnace filter 16x25x1', {
    isFood: false, categoryId: await prodCat('filters'), defaultUnit: 'ea',
    minQuantity: 2, defaultLocationId: utility.id,
    spec: { size: '16x25x1', merv: 11 },
  });
  const softenerSalt = await product('Water softener salt', { isFood: false, defaultUnit: 'bag', minQuantity: 1 });
  const battery9v = await product('9V battery', { isFood: false, categoryId: await prodCat('batteries'), defaultUnit: 'ea', minQuantity: 4 });
  const litter = await product('Cat litter', {
    isFood: false, isPetSupply: true, categoryId: await prodCat('litter'),
    defaultUnit: 'bag', minQuantity: 1,
  });
  const wetFood = await product('Wet cat food, chicken pâté', {
    isFood: true, isPetSupply: true, categoryId: await prodCat('cat-food-wet'),
    defaultUnit: 'can', minQuantity: 12, brand: 'Fancy Feast',
    shelfLife: { ambient: 900 }, unitMassKg: 0.085,
  });
  const dryFood = await product('Dry cat food, indoor formula', {
    isFood: true, isPetSupply: true, categoryId: await prodCat('cat-food-dry'),
    defaultUnit: 'bag', minQuantity: 1, packageSize: 7, packageUnit: 'lb',
    unitMassKg: 3.18,
  });
  const methimazole = await product('Methimazole 2.5mg', {
    isFood: false, isPetSupply: true, categoryId: await prodCat('pet-medications'), defaultUnit: 'dose',
  });
  const oatMilk = await product('Oat milk', {
    categoryId: await prodCat('dairy-eggs'), defaultUnit: 'bottle',
    minQuantity: 2, shelfLife: { refrigerated: 10, ambient: 180 }, useWithinDaysOpened: 7,
    unitMassKg: 0.95, emissionFactorKey: 'food.beverages',
  });
  const blackBeans = await product('Black beans', {
    categoryId: await prodCat('canned-goods'), defaultUnit: 'can',
    minQuantity: 4, shelfLife: { ambient: 900 }, unitMassKg: 0.42,
  });
  const eggs = await product('Eggs', {
    categoryId: await prodCat('dairy-eggs'), defaultUnit: 'ea',
    minQuantity: 6, shelfLife: { refrigerated: 28 },
    unitMassKg: 0.055, emissionFactorKey: 'food.eggs',
  });
  const chicken = await product('Chicken thighs', {
    categoryId: await prodCat('meat-seafood'), defaultUnit: 'lb',
    shelfLife: { refrigerated: 3, frozen: 270 }, emissionFactorKey: 'food.poultry',
  });
  const beef = await product('Ground beef', {
    categoryId: await prodCat('meat-seafood'), defaultUnit: 'lb',
    shelfLife: { refrigerated: 3, frozen: 180 }, emissionFactorKey: 'food.beef',
  });
  const pasta = await product('Pasta, penne', {
    categoryId: await prodCat('pasta'), defaultUnit: 'box', minQuantity: 2,
    shelfLife: { ambient: 730 }, unitMassKg: 0.454,
  });
  const sawBlade = await product('10" 60T saw blade', { isFood: false, categoryId: await prodCat('blades-bits'), defaultUnit: 'ea' });

  await db.insert(s.productBarcodes).values([
    { productId: oatMilk.id, barcode: '0012345678905', symbology: 'ean13' },
    { productId: blackBeans.id, barcode: '0041331092609', symbology: 'ean13' },
    { productId: wetFood.id, barcode: '0050000295203', symbology: 'ean13' },
  ]);

  await addStock(ctx, { productId: filter.id, quantity: 2, locationId: utility.id });
  await addStock(ctx, { productId: battery9v.id, quantity: 6, locationId: mudroom.id });
  await addStock(ctx, { productId: softenerSalt.id, quantity: 2, locationId: utility.id });
  await addStock(ctx, { productId: litter.id, quantity: 1, locationId: mudroom.id });
  await addStock(ctx, { productId: wetFood.id, quantity: 22, locationId: pantry.id });
  await addStock(ctx, { productId: dryFood.id, quantity: 1, locationId: pantry.id });
  await addStock(ctx, { productId: methimazole.id, quantity: 100, locationId: kitchen.id, unit: 'dose' });
  await addStock(ctx, { productId: oatMilk.id, quantity: 1, locationId: fridge.id, expiryDate: addDays(today, 4) });
  await addStock(ctx, { productId: eggs.id, quantity: 8, locationId: fridge.id, expiryDate: addDays(today, 6) });
  await addStock(ctx, { productId: chicken.id, quantity: 2.4, unit: 'lb', locationId: fridge.id, expiryDate: addDays(today, 2) });
  await addStock(ctx, { productId: chicken.id, quantity: 6, unit: 'lb', locationId: freezer.id, expiryDate: addDays(today, 180) });
  await addStock(ctx, { productId: beef.id, quantity: 2, unit: 'lb', locationId: freezer.id, expiryDate: addDays(today, 150) });
  await addStock(ctx, { productId: blackBeans.id, quantity: 3, locationId: pantry.id, expiryDate: addDays(today, 400) });
  await addStock(ctx, { productId: pasta.id, quantity: 4, locationId: pantry.id, expiryDate: addDays(today, 500) });

  /* ── maintenance plans, from the template library ── */

  const plan = async (
    assetId: string, targetName: string, title: string,
    spec: any, extra: Record<string, unknown> = {},
  ) => {
    const [row] = await db.insert(s.maintenancePlans).values({
      targetType: 'asset', targetId: assetId, title, createdBy: admin!.id, updatedBy: admin!.id, ...extra,
    }).returning();
    const scheduleId = await upsertSchedule(ctx, {
      spec, originType: 'maintenance', originId: row!.id,
      template: {
        title: `${title} — ${targetName}`,
        propertyId: property!.id,
        checklist: (extra.checklist as string[]) ?? [],
        estimateMin: (extra.estimateMin as number) ?? null,
      },
    });
    await db.update(s.maintenancePlans).set({ scheduleId }).where(eq(s.maintenancePlans.id, row!.id));
    return row!;
  };

  const filterPlan = await plan(furnace.id, 'Furnace', 'Replace air filter',
    { mode: 'floating', every: { days: 90 }, anchorDate: addDays(today, -88) },
    { estimateMin: 10, descriptionMd: 'Size 16x25x1, MERV 11. Arrow points toward the blower.' });
  await db.insert(s.planConsumables).values({ planId: filterPlan.id, productId: filter.id, quantity: 1, unit: 'ea' });

  await plan(furnace.id, 'Furnace', 'Professional tune-up',
    { mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=10', anchorDate: '2024-10-10' },
    { diy: false, vendorContactId: hvacCo.id, estimateMin: 90, estimateCost: 18500, seasonTags: ['fall'] });

  await plan(waterHeater.id, 'Water heater', 'Flush the tank',
    { mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=5;BYMONTHDAY=1', anchorDate: '2024-05-01' },
    { estimateMin: 60, checklist: ['Shut off power', 'Drain until clear', 'Refill before restoring power'] });

  const sumpPlan = await plan(sumpPump.id, 'Sump pump', 'Test operation',
    { mode: 'fixed', rrule: 'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1', anchorDate: addDays(today, -95) },
    { estimateMin: 10, graceDays: 7 });

  await plan(fridgeAsset.id, 'Refrigerator', 'Clean the condenser coils',
    { mode: 'fixed', rrule: 'FREQ=MONTHLY;INTERVAL=6;BYMONTHDAY=15', anchorDate: addDays(today, -170) },
    { estimateMin: 20 });

  const smokePlan = await plan(smoke.id, 'Smoke detectors', 'Test every unit',
    { mode: 'fixed', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', anchorDate: addDays(today, -40) },
    { estimateMin: 5 });
  await db.insert(s.planConsumables).values({ planId: smokePlan.id, productId: battery9v.id, quantity: 0, unit: 'ea' });

  await plan(mower.id, 'Lawn mower', 'Oil change and blade sharpen',
    { mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=20', anchorDate: '2025-04-20' },
    { estimateMin: 60, seasonTags: ['spring'] });

  // A little history so the asset timelines are not empty.
  await db.insert(s.maintenanceRecords).values([
    { targetType: 'asset', targetId: furnace.id, planId: filterPlan.id, kind: 'planned',
      title: 'Replace air filter', performedAt: addDays(today, -88), performerUserId: admin!.id, createdBy: admin!.id },
    { targetType: 'asset', targetId: sumpPump.id, planId: sumpPlan.id, kind: 'planned',
      title: 'Test operation', performedAt: addDays(today, -95), performerUserId: admin!.id, createdBy: admin!.id },
    { targetType: 'asset', targetId: roof.id, kind: 'repair',
      title: 'Replaced three blown shingles', performedAt: addDays(today, -400),
      failureDescription: 'Wind lifted shingles on the south slope', performerContactId: plumberB.id, createdBy: admin!.id },
  ]);

  /* ── tools ── */

  const tool = async (name: string, locationId: string, toolType: string, extra: Record<string, unknown> = {}) => {
    const [row] = await db.insert(s.assets).values({
      propertyId: property!.id, locationId, name, kind: 'tool',
      createdBy: admin!.id, updatedBy: admin!.id, ...extra,
    }).returning();
    await db.insert(s.toolProfiles).values({ assetId: row!.id, toolType, createdBy: admin!.id });
    return row!;
  };

  const [dewalt] = await db.insert(s.batteryPlatforms)
    .values({ name: 'DeWalt 20V MAX', brand: 'DeWalt', voltage: 20, createdBy: admin!.id }).returning();

  const drill = await tool('Impact driver', toolCabinet.id, 'power_battery', {
    make: 'DeWalt', model: 'DCF887', purchaseDate: '2021-02-10', purchasePrice: 16900,
  });
  await db.update(s.toolProfiles).set({ batteryPlatformId: dewalt!.id, powerSource: 'battery' })
    .where(eq(s.toolProfiles.assetId, drill.id));

  const circSaw = await tool('Circular saw', pegboard.id, 'power_corded', {
    make: 'Makita', model: '5007MG', purchaseDate: '2020-07-01', purchasePrice: 18900,
  });
  const multiTool = await tool('Oscillating multi-tool', toolCabinet.id, 'power_corded', {
    make: 'Fein', model: 'MM 500', purchaseDate: '2022-09-14', purchasePrice: 29900,
  });
  const laser = await tool('Laser level', toolCabinet.id, 'measuring', { make: 'Bosch', model: 'GLL3-330CG' });
  await tool('Tile trowel set', bin12.id, 'hand', {});
  await tool('Extension ladder', garage.id, 'access', { make: 'Werner', model: 'D1224-2' });

  await db.insert(s.batteries).values([
    { platformId: dewalt!.id, name: '5.0Ah pack A', capacityAh: 5, health: 'good', purchasedAt: '2021-02-10', locationId: toolCabinet.id, createdBy: admin!.id },
    { platformId: dewalt!.id, name: '5.0Ah pack B', capacityAh: 5, health: 'degraded', purchasedAt: '2021-02-10', locationId: toolCabinet.id, note: 'Runs down fast under load', createdBy: admin!.id },
    { platformId: dewalt!.id, name: '2.0Ah compact', capacityAh: 2, health: 'good', purchasedAt: '2023-05-02', locationId: toolCabinet.id, createdBy: admin!.id },
    { platformId: dewalt!.id, name: 'Dual-port charger', kind: 'charger', health: 'good', locationId: toolCabinet.id, createdBy: admin!.id },
  ]);

  const [bladeSpec] = await db.insert(s.toolConsumableSpecs).values({
    assetId: circSaw.id, description: '7-1/4" 24T framing blade', spec: { diameter: '7.25in', teeth: 24 }, createdBy: admin!.id,
  }).returning();
  await db.insert(s.toolConsumableProducts).values({ specId: bladeSpec!.id, productId: sawBlade.id });

  // The multi-tool is out with the neighbour; this is the thing you forget.
  const [multiLoanTask] = await db.insert(s.tasks).values({
    title: 'Get Oscillating multi-tool back from Dave next door',
    dueDate: addDays(today, -3), originType: 'loan_return', priority: 'normal',
    createdBy: admin!.id, updatedBy: admin!.id,
  }).returning();
  const [multiLoan] = await db.insert(s.loans).values({
    itemType: 'asset', itemId: multiTool.id, direction: 'out', contactId: neighbour.id,
    contactName: neighbour.name, lentAt: addDays(today, -24), dueBack: addDays(today, -3),
    taskId: multiLoanTask!.id, createdBy: admin!.id, updatedBy: admin!.id,
  }).returning();
  await db.update(s.tasks).set({ originId: multiLoan!.id }).where(eq(s.tasks.id, multiLoanTask!.id));
  await db.update(s.toolProfiles).set({ status: 'loaned_out' }).where(eq(s.toolProfiles.assetId, multiTool.id));

  /* ── storage ── */

  const storeCat = async (slug: string) => {
    const rows = await db.select().from(s.storageCategories).where(eq(s.storageCategories.slug, slug)).limit(1);
    return rows[0]?.id ?? null;
  };
  await db.insert(s.storageItems).values([
    { name: 'Christmas lights (3 strings)', locationId: tote7.id, categoryId: await storeCat('seasonal'),
      quantity: 3, estValue: 6000, createdBy: admin!.id, updatedBy: admin!.id },
    { name: 'Artificial tree', locationId: tote7.id, categoryId: await storeCat('seasonal'), estValue: 12000, createdBy: admin!.id, updatedBy: admin!.id },
    { name: 'Camp stove', locationId: bin12.id, categoryId: await storeCat('camping'), estValue: 8500, createdBy: admin!.id, updatedBy: admin!.id },
    { name: 'Two-person tent', locationId: bin12.id, categoryId: await storeCat('camping'), estValue: 22000, createdBy: admin!.id, updatedBy: admin!.id },
    { name: 'HDMI cables (assorted)', locationId: shelf3.id, categoryId: await storeCat('cables-adapters'), quantity: 6, createdBy: admin!.id, updatedBy: admin!.id },
    { name: 'Leftover bathroom tile', locationId: shelf3.id, categoryId: await storeCat('renovation-leftovers'), quantity: 14, createdBy: admin!.id, updatedBy: admin!.id },
    { name: 'Baby clothes 0-12m', locationId: bin12.id, categoryId: await storeCat('clothing'),
      reviewBy: addDays(today, -20), createdBy: admin!.id, updatedBy: admin!.id },
  ]);

  await db.insert(s.labelCodes).values([
    { code: 'HB12XZ', entityType: 'location', entityId: bin12.id, assignedAt: new Date().toISOString(), createdBy: admin!.id },
    { code: 'HT7QWR', entityType: 'location', entityId: tote7.id, assignedAt: new Date().toISOString(), createdBy: admin!.id },
    { code: 'HFURNA', entityType: 'asset', entityId: furnace.id, assignedAt: new Date().toISOString(), createdBy: admin!.id },
  ]);

  /* ── budget ── */

  const catByName = async (name: string) => {
    const rows = await db.select().from(s.categories).where(eq(s.categories.name, name)).limit(1);
    return rows[0]?.id ?? null;
  };
  const [checking] = await db.insert(s.accounts).values({
    name: 'Joint checking', type: 'checking', openingBalance: 840000, openingDate: addDays(today, -365), createdBy: admin!.id,
  }).returning();
  const [creditCard] = await db.insert(s.accounts).values({
    name: 'Visa', type: 'credit', openingBalance: 0, createdBy: admin!.id,
  }).returning();

  const groceriesCat = await catByName('Groceries');
  const maintCat = await catByName('Maintenance');
  const improvementsCat = await catByName('Improvements');
  const vetCat = await catByName('Vet');
  const petFoodCat = await catByName('Pet food');
  const electricityCat = await catByName('Electricity');
  const mortgageCat = await catByName('Mortgage/Rent');
  const toolsCat = await catByName('Tools');

  const period = today.slice(0, 7);
  const lastPeriod = addMonths(`${period}-01`, -1).slice(0, 7);
  for (const p of [lastPeriod, period]) {
    await db.insert(s.budgetAllocations).values([
      { period: p, categoryId: groceriesCat!, amount: 70000, createdBy: admin!.id },
      { period: p, categoryId: maintCat!, amount: 25000, createdBy: admin!.id },
      { period: p, categoryId: improvementsCat!, amount: 150000, createdBy: admin!.id },
      { period: p, categoryId: vetCat!, amount: 8000, createdBy: admin!.id },
      { period: p, categoryId: petFoodCat!, amount: 9000, createdBy: admin!.id },
      { period: p, categoryId: electricityCat!, amount: 16000, createdBy: admin!.id },
      { period: p, categoryId: mortgageCat!, amount: 187500, createdBy: admin!.id },
      { period: p, categoryId: toolsCat!, amount: 10000, createdBy: admin!.id },
    ]);
  }

  await attachCost(ctx, {
    amount: 187500, date: `${period}-01`, categoryId: mortgageCat, payeeName: 'Union Bank',
    accountId: checking!.id, memo: 'Mortgage', cleared: true,
  });
  await attachCost(ctx, {
    amount: 9640, date: addDays(today, -3), categoryId: groceriesCat, payeeName: grocer.name,
    accountId: creditCard!.id, memo: 'Weekly shop', cleared: true,
  });
  await attachCost(ctx, {
    amount: 12780, date: addDays(today, -11), categoryId: groceriesCat, payeeName: grocer.name,
    accountId: creditCard!.id, memo: 'Weekly shop', cleared: true,
  });
  await attachCost(ctx, {
    amount: 3800, date: addDays(today, -88), categoryId: maintCat, payeeName: hardware.name,
    accountId: creditCard!.id, memo: 'Furnace filters (4 pack)',
    attributions: [{ entityType: 'asset', entityId: furnace.id }],
  });
  await attachCost(ctx, {
    amount: 18500, date: addDays(today, -320), categoryId: maintCat, payeeName: hvacCo.name,
    accountId: checking!.id, memo: 'Annual furnace service',
    attributions: [{ entityType: 'asset', entityId: furnace.id }],
  });
  await attachCost(ctx, {
    amount: 16240, date: addDays(today, -6), categoryId: electricityCat, payeeName: 'Green Mountain Power',
    accountId: checking!.id, memo: 'Electricity', cleared: true,
  });

  const [electricBill] = await db.insert(s.recurringBills).values({
    name: 'Electricity', categoryId: electricityCat, accountId: checking!.id,
    amount: 16000, variable: true, leadDays: 5, createdBy: admin!.id, updatedBy: admin!.id,
  }).returning();
  const electricSchedule = await upsertSchedule(ctx, {
    spec: { mode: 'fixed', rrule: 'FREQ=MONTHLY;BYMONTHDAY=18', anchorDate: addDays(today, -60) },
    originType: 'bill', originId: electricBill!.id,
    template: { title: 'Pay Electricity', priority: 'high' }, horizonDays: 90,
  });
  await db.update(s.recurringBills).set({ scheduleId: electricSchedule }).where(eq(s.recurringBills.id, electricBill!.id));

  const [mortgageBill] = await db.insert(s.recurringBills).values({
    name: 'Mortgage', categoryId: mortgageCat, accountId: checking!.id,
    amount: 187500, leadDays: 3, createdBy: admin!.id, updatedBy: admin!.id,
  }).returning();
  const mortgageSchedule = await upsertSchedule(ctx, {
    spec: { mode: 'fixed', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', anchorDate: addDays(today, -90) },
    originType: 'bill', originId: mortgageBill!.id,
    template: { title: 'Pay Mortgage', priority: 'high' }, horizonDays: 90,
  });
  await db.update(s.recurringBills).set({ scheduleId: mortgageSchedule }).where(eq(s.recurringBills.id, mortgageBill!.id));

  await db.insert(s.goals).values({
    name: 'New roof fund', targetAmount: 1400000, targetDate: addDays(today, 1460),
    accountId: checking!.id, createdBy: admin!.id, updatedBy: admin!.id,
  });


  /* ── energy, metered and delivered ── */

  const electricMeter = await asset('Electricity meter', 'service-panel', utility.id, {
    make: 'Itron', model: 'CENTRON', serial: 'GMP-4471288',
    installedDate: '2019-06-14',
  });
  await db.insert(s.meters).values({
    assetId: electricMeter.id, kind: 'electricity', unit: 'kwh',
    emissionFactorKey: 'electricity.grid', multiplier: 1, rolloverAt: 100000,
    serial: 'GMP-4471288', installedOn: '2019-06-14', createdBy: admin!.id,
  });

  // Fourteen months of readings. The shape is a real one: electric heat in the
  // shoulder months, air conditioning in July and August.
  const monthlyKwh = [980, 910, 820, 690, 620, 700, 880, 910, 690, 640, 730, 900, 1010, 940];
  let meterValue = 42_180;
  for (let i = monthlyKwh.length; i >= 1; i--) {
    const takenAt = addDays(today, -(i - 1) * 30);
    await db.insert(s.readings).values({
      assetId: electricMeter.id, metric: 'kwh', value: Number(meterValue.toFixed(1)),
      unit: 'kwh', takenAt, createdBy: admin!.id, updatedBy: admin!.id,
    });
    meterValue += monthlyKwh[monthlyKwh.length - i]!;
  }
  // Difference the readings into consumption, exactly as the app would.
  const readingRows = await db.select().from(s.readings)
    .where(eq(s.readings.assetId, electricMeter.id)).orderBy(s.readings.takenAt);
  const { activityFromReading } = await import('../services/carbon.js');
  for (const r of readingRows) {
    await activityFromReading(ctx, r.id).catch(() => undefined);
  }

  // Oil deliveries: one transaction and one activity each, entered once.
  const deliveries: Array<[number, number, number]> = [
    // [days ago, gallons, price in cents]
    [330, 212, 68_900], [285, 198, 64_400], [250, 224, 73_100],
    [210, 176, 57_200], [40, 168, 55_400],
  ];
  for (const [daysAgo, gallons, cents] of deliveries) {
    const date = addDays(today, -daysAgo);
    const { transaction } = await attachCost(ctx, {
      amount: cents, date, categoryId: await catByName('Gas/Heating'),
      payeeName: 'Valley Fuel', accountId: checking!.id,
      memo: `Heating oil, ${gallons} gallons`,
      attributions: [{ entityType: 'asset', entityId: furnace.id }],
    });
    await recordActivity(ctx, {
      type: 'heating_oil', amount: gallons, unit: 'gal', occurredOn: date,
      propertyId: property!.id, transactionId: transaction.id,
      note: `Delivery, ${gallons} gallons`,
      attributions: [{ entityType: 'asset', entityId: furnace.id }],
    });
  }

  // The electricity bill carries its meter, so paying it records both measures.
  await db.update(s.recurringBills).set({
    meteredUnit: 'kwh', emissionFactorKey: 'electricity.grid', meterAssetId: electricMeter.id,
  }).where(eq(s.recurringBills.id, electricBill!.id));

  // Twelve paid bills, each attaching its cost to the period the meter already
  // recorded. Two records of the same kilowatt hours, counted once.
  const { attachCostToMeteredPeriod } = await import('../services/carbon.js');
  for (let i = 12; i >= 1; i--) {
    const billDate = addDays(today, -(i - 1) * 30 - 5);
    const kwh = monthlyKwh[monthlyKwh.length - i] ?? 800;
    const cents = Math.round(kwh * 21.4); // about 21 cents a kilowatt hour
    const { transaction } = await attachCost(ctx, {
      amount: cents, date: billDate, categoryId: electricityCat,
      payeeName: 'Green Mountain Power', accountId: checking!.id,
      memo: 'Electricity', cleared: true, recurringBillId: electricBill!.id,
    });
    await attachCostToMeteredPeriod(ctx, {
      meterAssetId: electricMeter.id, type: 'electricity',
      periodEnd: billDate, transactionId: transaction.id,
    });
  }

  // Water, read quarterly.
  for (const [daysAgo, m3] of [[270, 41], [180, 38], [90, 44], [10, 40]] as Array<[number, number]>) {
    await recordActivity(ctx, {
      type: 'water', amount: m3, unit: 'm3', occurredOn: addDays(today, -daysAgo),
      propertyId: property!.id, note: 'Quarterly water reading',
    });
  }

  // A refrigerant top-up, small in mass and large in effect.
  await recordActivity(ctx, {
    type: 'refrigerant', amount: 0.4, unit: 'kg', occurredOn: addDays(today, -120),
    factorKey: 'refrigerant.r410a', propertyId: property!.id,
    note: 'R-410A added to the mini-split during service',
    attributions: [{ entityType: 'asset', entityId: fridgeAsset.id }],
  });

  // A year of groceries, in the aggregate, so the food slice is not empty.
  for (const [key, kg, daysAgo] of [
    ['food.beef', 14, 200], ['food.poultry', 38, 190], ['food.milk', 96, 180],
    ['food.vegetables', 130, 170], ['food.grains', 72, 160], ['food.cheese', 11, 150],
    ['food.fruit', 88, 140], ['food.eggs', 24, 130], ['food.coffee', 6, 120],
  ] as Array<[string, number, number]>) {
    await recordActivity(ctx, {
      type: 'food', amount: kg, unit: 'kg', occurredOn: addDays(today, -daysAgo),
      factorKey: key, propertyId: property!.id, note: 'Groceries, aggregated',
    });
  }

  // Waste, weighed at the transfer station.
  for (const [daysAgo, kg, route] of [
    [60, 78, 'waste.landfill'], [60, 46, 'waste.recycled'], [150, 82, 'waste.landfill'],
  ] as Array<[number, number, string]>) {
    await recordActivity(ctx, {
      type: 'waste', amount: kg, unit: 'kg', occurredOn: addDays(today, -daysAgo),
      factorKey: route, propertyId: property!.id, note: 'Transfer station run',
    });
  }

  // A target to measure against.
  await db.insert(s.carbonTargets).values({
    period: today.slice(0, 4), gCo2e: 12_000_000,
    note: 'Twelve tonnes this year, on the way to halving by 2032.',
    createdBy: admin!.id, updatedBy: admin!.id,
  });

  // Two candidates, costed against what this house actually burns.
  for (const key of ['heat_pump', 'attic_insulation']) {
    const template = (await db.select().from(s.interventionTemplates)
      .where(eq(s.interventionTemplates.key, key)).limit(1))[0];
    if (!template) continue;
    const estimate = await estimateIntervention(ctx, {
      model: template.savingModel ?? { kind: 'reduce' },
      capitalCost: template.typicalCost ?? 0,
      embodiedGCo2e: template.embodiedGCo2e ?? 0,
      lifetimeYears: template.lifetimeYears,
    });
    await db.insert(s.interventions).values({
      templateKey: template.key, name: template.name, category: template.category,
      descriptionMd: template.descriptionMd, propertyId: property!.id,
      targetAssetId: key === 'heat_pump' ? furnace.id : null,
      capitalCost: template.typicalCost, embodiedGCo2e: template.embodiedGCo2e ?? 0,
      annualSavingKwh: estimate.annualSavingKwh,
      annualSavingCost: estimate.annualSavingCost,
      annualSavingGCo2e: estimate.annualSavingGCo2e,
      basis: estimate.basis, basisNote: estimate.basisNote,
      lifetimeYears: template.lifetimeYears,
      createdBy: admin!.id, updatedBy: admin!.id,
    });
  }

  await recordDailyPetFood(ctx, addDays(today, -1));

  /* ── the bathroom remodel, mid-flight ── */

  const [project] = await db.insert(s.projects).values({
    propertyId: property!.id, name: 'Main bathroom remodel',
    descriptionMd: 'Gut and refit the upstairs bathroom. Keep the window, move the vanity to the east wall.',
    status: 'in_progress', ownerUserId: admin!.id, priority: 'high',
    targetStart: addDays(today, -34), targetEnd: addDays(today, 26), actualStart: addDays(today, -30),
    budgetAmount: 1200000,
    budgetBreakdown: { materials: 450000, labour: 500000, permits: 40000, tools: 30000, disposal: 40000, contingency: 140000 },
    createdBy: admin!.id, updatedBy: admin!.id,
  }).returning();
  await db.insert(s.projectLocations).values({ projectId: project!.id, locationId: mainBath.id });

  const phaseNames = ['Demo', 'Rough-in', 'Inspection', 'Tile', 'Finish'];
  const phaseIds: string[] = [];
  for (const [i, name] of phaseNames.entries()) {
    const [row] = await db.insert(s.projectPhases).values({
      projectId: project!.id, name, sort: i,
      status: i < 2 ? 'complete' : i === 2 ? 'in_progress' : 'planning',
      targetStart: addDays(today, -30 + i * 12), targetEnd: addDays(today, -20 + i * 12),
      createdBy: admin!.id,
    }).returning();
    phaseIds.push(row!.id);
  }

  const projectTasks: Array<[string, number, string, string]> = [
    ['Protect floors and hallway', 0, 'done', addDays(today, -30)],
    ['Remove fixtures', 0, 'done', addDays(today, -29)],
    ['Remove tile and drywall', 0, 'done', addDays(today, -27)],
    ['Haul debris to transfer station', 0, 'done', addDays(today, -26)],
    ['Rough plumbing', 1, 'done', addDays(today, -18)],
    ['Rough electrical', 1, 'done', addDays(today, -16)],
    ['Move exhaust vent', 1, 'in_progress', addDays(today, -1)],
    ['Book rough inspection', 2, 'open', addDays(today, 2)],
    ['Hang cement board', 3, 'open', addDays(today, 9)],
    ['Waterproof the shower', 3, 'open', addDays(today, 11)],
    ['Set floor tile', 3, 'open', addDays(today, 14)],
    ['Set wall tile', 3, 'open', addDays(today, 16)],
    ['Grout and seal', 3, 'open', addDays(today, 18)],
    ['Hang and finish drywall', 4, 'open', addDays(today, 20)],
    ['Paint', 4, 'open', addDays(today, 22)],
    ['Set vanity and toilet', 4, 'open', addDays(today, 24)],
    ['Install fixtures and trim', 4, 'open', addDays(today, 25)],
  ];
  for (const [title, phaseIdx, status, due] of projectTasks) {
    await db.insert(s.tasks).values({
      title, projectId: project!.id, phaseId: phaseIds[phaseIdx]!,
      originType: 'project', originId: project!.id, status,
      dueDate: due, completedAt: status === 'done' ? due : null,
      completedBy: status === 'done' ? admin!.id : null,
      createdBy: admin!.id, updatedBy: admin!.id,
    });
  }

  // Each line carries what it is made of, so the project has a footprint as
  // well as a budget (GHG-012).
  const materials: Array<[string, number, string, number, string, string | null, number | null]> = [
    ['Floor tile, 12x24 porcelain', 62, 'ea', 480, 'received', 'material.tile', 3.4],
    ['Wall tile, 3x6 subway', 140, 'ea', 190, 'received', 'material.tile', 0.35],
    ['Cement board', 8, 'ea', 1450, 'received', 'material.concrete', 13.6],
    ['Waterproofing membrane', 1, 'ea', 12800, 'received', null, null],
    ['Thinset mortar', 4, 'bag', 2400, 'ordered', 'material.cement', 22.7],
    ['Grout, charcoal', 2, 'bag', 2800, 'needed', 'material.cement', 11.3],
    ['Vanity, 36" oak', 1, 'ea', 84000, 'ordered', 'material.lumber', 41],
    ['Toilet, comfort height', 1, 'ea', 32900, 'needed', 'material.tile', 38],
    ['Shower valve and trim', 1, 'ea', 41500, 'received', 'material.copper', 2.1],
    ['Exhaust fan, 110 CFM', 1, 'ea', 13900, 'received', 'material.steel', 4.5],
  ];
  for (const [description, quantity, unit, estUnitCost, status, factorKey, massKg] of materials) {
    await db.insert(s.projectMaterials).values({
      projectId: project!.id, description, quantity, unit, estUnitCost, status,
      supplierContactId: hardware.id, emissionFactorKey: factorKey, unitMassKg: massKg,
      createdBy: admin!.id, updatedBy: admin!.id,
    });
  }

  // The materials already bought emitted when they were made.
  const boughtMaterials = await db.select().from(s.projectMaterials).where(and(
    eq(s.projectMaterials.projectId, project!.id),
    eq(s.projectMaterials.status, 'received'),
  ));
  for (const m of boughtMaterials) {
    if (!m.emissionFactorKey || !m.unitMassKg) continue;
    const recorded = await recordActivity(ctx, {
      type: 'material', amount: m.quantity * m.unitMassKg, unit: 'kg',
      occurredOn: addDays(today, -22), factorKey: m.emissionFactorKey,
      propertyId: property!.id, sourceType: 'project_material', sourceId: m.id,
      note: m.description,
      attributions: [{ entityType: 'project', entityId: project!.id }],
    });
    await db.update(s.projectMaterials).set({ activityId: recorded.activity.id })
      .where(eq(s.projectMaterials.id, m.id));
  }

  await db.insert(s.projectTools).values([
    { projectId: project!.id, assetId: multiTool.id },
    { projectId: project!.id, assetId: drill.id },
    { projectId: project!.id, assetId: laser.id },
  ]);
  await db.insert(s.projectToolWishes).values({
    projectId: project!.id, description: 'Wet tile saw, 7"', estCost: 32000, rentOrBuy: 'rent',
    note: 'Rent for the tile weekend rather than buy.', createdBy: admin!.id,
  });

  await db.insert(s.quotes).values([
    { projectId: project!.id, contactId: plumber.id, scope: 'Plumbing rough-in and fixture set',
      amount: 320000, quotedAt: addDays(today, -40), validUntil: addDays(today, 20), status: 'accepted',
      createdBy: admin!.id, updatedBy: admin!.id },
    { projectId: project!.id, contactId: plumberB.id, scope: 'Plumbing rough-in and fixture set',
      amount: 412000, quotedAt: addDays(today, -39), status: 'rejected', createdBy: admin!.id, updatedBy: admin!.id },
  ]);

  const [permit] = await db.insert(s.permits).values({
    projectId: project!.id, name: 'Plumbing permit', permitNumber: 'PL-2026-0412',
    authorityContactId: null, appliedAt: addDays(today, -35), issuedAt: addDays(today, -31),
    status: 'issued', createdBy: admin!.id, updatedBy: admin!.id,
  }).returning();
  await db.insert(s.inspections).values({
    permitId: permit!.id, name: 'Rough plumbing inspection',
    scheduledAt: addDays(today, 2), createdBy: admin!.id,
  });

  await db.insert(s.decisions).values([
    { projectId: project!.id, decidedAt: addDays(today, -28), title: 'Keep the window where it is',
      rationaleMd: 'Moving it means new header and siding work. Not worth 1200 dollars for six inches.',
      alternativesMd: 'Shift 18" east; replace with a glass block.', decidedBy: admin!.id, createdBy: admin!.id },
    { projectId: project!.id, decidedAt: addDays(today, -20), title: 'Charcoal grout, not white',
      rationaleMd: 'White grout on a bathroom floor is a losing battle.', decidedBy: partner!.id, createdBy: admin!.id },
  ]);

  for (const [amount, memo, days, cat] of [
    [289400, 'Tile and setting materials', -22, improvementsCat],
    [160000, 'Plumbing deposit', -30, improvementsCat],
    [41500, 'Shower valve and trim', -19, improvementsCat],
    [13900, 'Exhaust fan', -19, improvementsCat],
    [4000, 'Plumbing permit fee', -35, improvementsCat],
  ] as Array<[number, string, number, string | null]>) {
    await attachCost(ctx, {
      amount, date: addDays(today, days), categoryId: cat, payeeName: hardware.name,
      accountId: creditCard!.id, memo,
      attributions: [{ entityType: 'project', entityId: project!.id }],
    });
  }

  // An idea for the backlog, which feeds long-range planning.
  await db.insert(s.projects).values({
    propertyId: property!.id, name: 'Replace the deck', status: 'idea', priority: 'normal',
    descriptionMd: 'The 2009 pressure-treated deck is cupping. Composite next time.',
    estimateCost: 900000, targetStart: addDays(today, 400),
    createdBy: admin!.id, updatedBy: admin!.id,
  });

  /* ── the cat ── */

  const [pepper] = await db.insert(s.pets).values({
    name: 'Pepper', speciesCode: 'cat', breed: 'Domestic shorthair', sex: 'female',
    neutered: true, dob: '2014-04-02', adoptedAt: '2014-08-11', microchip: '985112004598217',
    markings: 'Black with a white chest patch and one white toe.',
    primaryVetContactId: vet.id, emergencyVetContactId: emergencyVet.id,
    targetWeightMin: 9, targetWeightMax: 11, weightUnit: 'lb',
    careNotesMd: 'Hides under the bed during thunderstorms. Will not eat fish flavours. Pills go in a Pill Pocket.',
    createdBy: admin!.id, updatedBy: admin!.id,
  }).returning();

  const [pip] = await db.insert(s.pets).values({
    name: 'Pip', speciesCode: 'cat', breed: 'Tabby', sex: 'male', neutered: true,
    dob: '2021-06-15', microchip: '985112007713442', markings: 'Brown tabby, notched left ear.',
    primaryVetContactId: vet.id, emergencyVetContactId: emergencyVet.id,
    targetWeightMin: 10, targetWeightMax: 13, weightUnit: 'lb',
    createdBy: admin!.id, updatedBy: admin!.id,
  }).returning();

  for (const [petId, weights] of [
    [pepper!.id, [[-400, 11.4], [-300, 11.1], [-200, 10.6], [-120, 10.0], [-60, 9.4], [-20, 9.1]]],
    [pip!.id, [[-300, 11.8], [-150, 12.1], [-20, 12.4]]],
  ] as Array<[string, Array<[number, number]>]>) {
    for (const [days, weight] of weights) {
      await db.insert(s.petWeights).values({
        petId, takenAt: addDays(today, days), weight, unit: 'lb',
        source: 'manual', createdBy: admin!.id, updatedBy: admin!.id,
      });
    }
  }

  await db.insert(s.petVaccinations).values([
    { petId: pepper!.id, vaccine: 'Rabies', givenAt: addDays(today, -700), nextDue: addDays(today, 395), providerContactId: vet.id, createdBy: admin!.id, updatedBy: admin!.id },
    { petId: pepper!.id, vaccine: 'FVRCP', givenAt: addDays(today, -340), nextDue: addDays(today, 25), providerContactId: vet.id, createdBy: admin!.id, updatedBy: admin!.id },
    { petId: pip!.id, vaccine: 'Rabies', givenAt: addDays(today, -200), nextDue: addDays(today, 895), providerContactId: vet.id, createdBy: admin!.id, updatedBy: admin!.id },
    { petId: pip!.id, vaccine: 'FVRCP', givenAt: addDays(today, -200), nextDue: addDays(today, 165), providerContactId: vet.id, createdBy: admin!.id, updatedBy: admin!.id },
  ]);

  const [hyperT] = await db.insert(s.petConditions).values({
    petId: pepper!.id, name: 'Hyperthyroidism', onsetDate: addDays(today, -21), status: 'active',
    notesMd: 'T4 was 6.8 at diagnosis. Started on methimazole; recheck in 4 weeks.',
    createdBy: admin!.id, updatedBy: admin!.id,
  }).returning();

  const [visit] = await db.insert(s.petVisits).values({
    petId: pepper!.id, visitedAt: addDays(today, -21), providerContactId: vet.id,
    reason: 'Weight loss and increased appetite', diagnosis: 'Hyperthyroidism',
    notesMd: 'Palpable thyroid nodule. Bloodwork confirms. Start methimazole 2.5mg BID, recheck T4 in 4 weeks.',
    weight: 9.4, weightUnit: 'lb', followUpDate: addDays(today, 7),
    createdBy: admin!.id, updatedBy: admin!.id,
  }).returning();

  const { transaction: vetTx } = await attachCost(ctx, {
    amount: 21500, date: addDays(today, -21), categoryId: vetCat, payeeName: vet.name,
    accountId: creditCard!.id, memo: 'Pepper: exam and bloodwork',
    attributions: [{ entityType: 'pet', entityId: pepper!.id }],
  });
  await db.update(s.petVisits).set({ costTransactionId: vetTx.id }).where(eq(s.petVisits.id, visit!.id));

  const [followUpTask] = await db.insert(s.tasks).values({
    title: 'Pepper: T4 recheck at the vet', dueDate: addDays(today, 7),
    originType: 'pet_appointment', originId: pepper!.id, priority: 'high',
    createdBy: admin!.id, updatedBy: admin!.id,
  }).returning();
  await db.update(s.petVisits).set({ followUpTaskId: followUpTask!.id }).where(eq(s.petVisits.id, visit!.id));

  await db.insert(s.petLabResults).values([
    { petId: pepper!.id, visitId: visit!.id, test: 'T4', value: 6.8, unit: 'µg/dL', refLow: 0.8, refHigh: 4.0, takenAt: addDays(today, -21), createdBy: admin!.id },
    { petId: pepper!.id, visitId: visit!.id, test: 'Creatinine', value: 1.6, unit: 'mg/dL', refLow: 0.8, refHigh: 2.4, takenAt: addDays(today, -21), createdBy: admin!.id },
    { petId: pepper!.id, test: 'T4', value: 9.1, unit: 'µg/dL', refLow: 0.8, refHigh: 4.0, takenAt: addDays(today, -400), createdBy: admin!.id },
    { petId: pepper!.id, test: 'Creatinine', value: 1.4, unit: 'mg/dL', refLow: 0.8, refHigh: 2.4, takenAt: addDays(today, -400), createdBy: admin!.id },
  ]);

  await db.insert(s.petMedications).values({
    petId: pepper!.id, name: 'Methimazole', form: 'tablet', strength: '2.5mg',
    dose: '1 tablet', route: 'oral', timesOfDay: ['08:00', '20:00'], everyDays: 1,
    startDate: addDays(today, -21), ongoing: true, vetContactId: vet.id,
    productId: methimazole.id, dosesPerUnit: 1, refillsRemaining: 2, refillQty: 100,
    conditionId: hyperT!.id,
    instructionsMd: 'Give with food. Wash hands after handling. Watch for facial itching.',
    createdBy: admin!.id, updatedBy: admin!.id,
  });

  await db.insert(s.petMedications).values([
    { petId: pepper!.id, name: 'Revolution Plus', form: 'topical', kind: 'preventive',
      dose: '1 tube', route: 'topical', timesOfDay: ['19:00'], everyDays: 30,
      startDate: addDays(today, -20), ongoing: true, vetContactId: vet.id,
      createdBy: admin!.id, updatedBy: admin!.id },
    { petId: pip!.id, name: 'Revolution Plus', form: 'topical', kind: 'preventive',
      dose: '1 tube', route: 'topical', timesOfDay: ['19:00'], everyDays: 30,
      startDate: addDays(today, -20), ongoing: true, vetContactId: vet.id,
      createdBy: admin!.id, updatedBy: admin!.id },
  ]);

  await db.insert(s.petDietEntries).values([
    { petId: pepper!.id, timeOfDay: '07:30', productId: wetFood.id, amount: 1, unit: 'can', activeFrom: addDays(today, -21), createdBy: admin!.id, updatedBy: admin!.id },
    { petId: pepper!.id, timeOfDay: '19:30', productId: wetFood.id, amount: 1, unit: 'can', activeFrom: addDays(today, -21), createdBy: admin!.id, updatedBy: admin!.id },
    { petId: pip!.id, timeOfDay: '07:30', productId: wetFood.id, amount: 1, unit: 'can', activeFrom: addDays(today, -200), createdBy: admin!.id, updatedBy: admin!.id },
    { petId: pip!.id, timeOfDay: '19:30', productId: dryFood.id, amount: 0.06, unit: 'bag', activeFrom: addDays(today, -200), createdBy: admin!.id, updatedBy: admin!.id },
  ]);

  await db.insert(s.petJournal).values([
    { petId: pepper!.id, ts: addDays(today, -30), bodyMd: 'Eating everything in sight but looks thinner. Bowl licked clean twice.', tags: ['Appetite up'], severity: 'mild', createdBy: admin!.id, updatedBy: admin!.id },
    { petId: pepper!.id, ts: addDays(today, -26), bodyMd: 'Threw up twice overnight in the hallway.', tags: ['Vomiting'], severity: 'moderate', createdBy: admin!.id, updatedBy: admin!.id },
    { petId: pepper!.id, ts: addDays(today, -24), bodyMd: 'Drinking a lot more than usual. Refilled the fountain twice.', tags: ['Thirst up'], severity: 'moderate', createdBy: admin!.id, updatedBy: admin!.id },
    { petId: pepper!.id, ts: addDays(today, -21), bodyMd: 'Vet visit. Hyperthyroid. Starting methimazole tonight.', tags: [], severity: 'info', visitId: visit!.id, createdBy: admin!.id, updatedBy: admin!.id },
    { petId: pepper!.id, ts: addDays(today, -8), bodyMd: 'Calmer this week. Ate both meals without pacing.', tags: [], severity: 'info', createdBy: admin!.id, updatedBy: admin!.id },
    { petId: pip!.id, ts: addDays(today, -5), bodyMd: 'Hairball on the stairs. Third this month.', tags: ['Hairballs'], severity: 'mild', createdBy: admin!.id, updatedBy: admin!.id },
  ]);

  const [policy] = await db.insert(s.petInsurance).values({
    petId: pepper!.id, insurerContactId: insurer.id, policyNumber: 'TRU-88241-VT',
    deductible: 25000, reimbursementPct: 90,
    createdBy: admin!.id, updatedBy: admin!.id,
  }).returning();
  await db.insert(s.petClaims).values({
    insuranceId: policy!.id, visitId: visit!.id, claimedAmount: 21500,
    status: 'submitted', submittedAt: addDays(today, -19),
    createdBy: admin!.id, updatedBy: admin!.id,
  });

  /* ── household tasks, chores and a board ── */

  const chores: Array<[string, any, string | null]> = [
    ['Take the trash to the curb', { mode: 'fixed', rrule: 'FREQ=WEEKLY;BYDAY=TU', anchorDate: addDays(today, -28), timeOfDay: '20:00' }, admin!.id],
    ['Laundry', { mode: 'fixed', rrule: 'FREQ=WEEKLY;BYDAY=SA', anchorDate: addDays(today, -28) }, partner!.id],
    ['Scoop the litter boxes', { mode: 'fixed', rrule: 'FREQ=DAILY', anchorDate: addDays(today, -7), timeOfDay: '18:00' }, null],
    ['Water the houseplants', { mode: 'floating', every: { days: 5 }, anchorDate: addDays(today, -4) }, partner!.id],
    ['Vacuum the main floor', { mode: 'fixed', rrule: 'FREQ=WEEKLY;BYDAY=SU', anchorDate: addDays(today, -28) }, null],
  ];
  for (const [title, spec, assignee] of chores) {
    await upsertSchedule(ctx, {
      spec, originType: 'manual', originId: `chore-${title}`,
      template: { title, propertyId: property!.id, assignees: assignee ? [assignee] : [] },
      horizonDays: 21,
    });
  }

  await db.insert(s.tasks).values([
    { title: 'Call about the chimney sweep', dueDate: addDays(today, 4), priority: 'normal', createdBy: admin!.id, updatedBy: admin!.id },
    { title: 'Figure out the well water test kit', dueDate: addDays(today, -2), priority: 'low', createdBy: admin!.id, updatedBy: admin!.id },
    { title: 'Order replacement screen for the mudroom door', priority: 'low', createdBy: admin!.id, updatedBy: admin!.id },
  ]);

  const [board] = await db.insert(s.boards).values({
    name: 'House', propertyId: property!.id, shared: true, createdBy: admin!.id, updatedBy: admin!.id,
  }).returning();
  const laneDefs = [
    { name: 'This week', statusMapping: null, sort: 0 },
    { name: 'Doing', statusMapping: 'in_progress', sort: 1 },
    { name: 'Waiting on someone', statusMapping: 'blocked', sort: 2 },
    { name: 'Done', statusMapping: 'done', sort: 3 },
  ];
  const laneIds: string[] = [];
  for (const l of laneDefs) {
    const [row] = await db.insert(s.lanes).values({ boardId: board!.id, ...l, createdBy: admin!.id }).returning();
    laneIds.push(row!.id);
  }

  /* ── shopping list ── */

  const [list] = await db.insert(s.shoppingLists).values({
    name: 'Grocery', isDefault: true, storeContactId: grocer.id, createdBy: admin!.id, updatedBy: admin!.id,
  }).returning();
  await db.insert(s.shoppingLists).values({
    name: 'Hardware', storeContactId: hardware.id, createdBy: admin!.id, updatedBy: admin!.id,
  });
  await db.insert(s.shoppingLines).values([
    { listId: list!.id, productId: oatMilk.id, text: 'Oat milk', quantity: 2, unit: 'bottle', sourceType: 'low_stock', sourceId: oatMilk.id, createdBy: admin!.id, updatedBy: admin!.id },
    { listId: list!.id, text: 'Coffee beans', quantity: 1, unit: 'bag', sourceType: 'manual', createdBy: admin!.id, updatedBy: admin!.id },
    { listId: list!.id, text: 'Dish soap', quantity: 1, unit: 'ea', sourceType: 'manual', createdBy: admin!.id, updatedBy: admin!.id },
  ]);

  /* ── a recipe, to prove the pantry link ── */

  const [recipe] = await db.insert(s.recipes).values({
    name: 'Weeknight chicken and beans', servings: 4, prepMin: 10, cookMin: 30,
    stepsMd: '1. Brown the thighs skin down.\n2. Add beans and stock.\n3. Cover, 25 minutes.\n4. Finish with lemon.',
    createdBy: admin!.id, updatedBy: admin!.id,
  }).returning();
  await db.insert(s.recipeIngredients).values([
    { recipeId: recipe!.id, productId: chicken.id, text: 'Chicken thighs', quantity: 2, unit: 'lb', sort: 0 },
    { recipeId: recipe!.id, productId: blackBeans.id, text: 'Black beans', quantity: 2, unit: 'can', sort: 1 },
    { recipeId: recipe!.id, text: 'Lemon', quantity: 1, unit: 'ea', sort: 2 },
  ]);

  /* ── generate the schedule instances and doses ── */

  const mat = await materialiseAll(ctx);
  const doses = await materialiseDoses(ctx, { horizonDays: 3 });

  // Place the open tasks on the board so it is not empty on first open.
  const open = await db.select().from(s.tasks).where(eq(s.tasks.status, 'open')).limit(12);
  for (const [i, t] of open.entries()) {
    await db.insert(s.boardTasks)
      .values({ boardId: board!.id, laneId: laneIds[0]!, taskId: t.id, sort: i })
      .onConflictDoNothing();
  }

  const counts: Record<string, number> = {
    tasksGenerated: mat.created,
    dosesGenerated: doses.created,
  };
  for (const [name, table] of [
    ['assets', s.assets], ['locations', s.locations], ['products', s.products],
    ['stockItems', s.stockItems], ['transactions', s.transactions], ['maintenancePlans', s.maintenancePlans],
    ['tasks', s.tasks], ['pets', s.pets], ['storageItems', s.storageItems], ['contacts', s.contacts],
    ['activities', s.activities], ['emissions', s.emissions], ['interventions', s.interventions],
  ] as Array<[string, any]>) {
    const r = await db.select().from(table);
    counts[name] = r.length;
  }

  return {
    users: [
      { username: 'matt', password },
      { username: 'alex', password },
      { username: 'sam', password },
    ],
    counts,
  };
}
