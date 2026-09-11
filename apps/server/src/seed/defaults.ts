/* eslint-disable @typescript-eslint/no-explicit-any */
import { eq, sql } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import {
  assetCategories, categories, emissionFactors, interventionTemplates, maintenanceTemplates,
  productCategories, projectTemplates, speciesProfiles, storageCategories,
} from '../db/schema.js';
import { FACTOR_SEEDS, INTERVENTION_TEMPLATES, PRODUCT_CATEGORY_FACTORS } from './factors.js';

/** Appendix B of the requirements, as data. Idempotent: safe on every boot. */

const ASSET_CATEGORIES: Array<[string, string, number | null, string[]]> = [
  ['appliances', 'Appliances', null, [
    'Refrigerator:14', 'Freezer:15', 'Range/Oven:15', 'Cooktop:15', 'Range hood:14',
    'Dishwasher:10', 'Microwave:9', 'Washer:11', 'Dryer:13', 'Water softener:15', 'Garbage disposal:10',
  ]],
  ['hvac', 'HVAC', null, [
    'Furnace:20', 'Boiler:25', 'Heat pump:15', 'Air conditioner:15', 'Mini-split:15',
    'Thermostat:10', 'Humidifier:10', 'Air purifier:8', 'Ductwork:30',
  ]],
  ['plumbing', 'Plumbing', null, [
    'Water heater:12', 'Well pump:12', 'Pressure tank:12', 'Sump pump:8', 'Sewage ejector:10',
    'Septic system:30', 'Water filtration:10', 'Backflow preventer:10', 'Main shutoff:30',
  ]],
  ['electrical', 'Electrical', null, [
    'Service panel:40', 'Sub-panel:40', 'Generator:20', 'Transfer switch:20',
    'EV charger:12', 'Solar inverter:12', 'Battery storage:12',
  ]],
  ['envelope', 'Envelope', null, [
    'Roof:25', 'Gutters:20', 'Siding:30', 'Windows:25', 'Exterior doors:25',
    'Garage door:20', 'Garage door opener:12', 'Deck:15', 'Fence:15', 'Chimney:40', 'Insulation:40',
  ]],
  ['interior', 'Interior', null, [
    'Flooring:20', 'Fireplace:30', 'Wood stove:20', 'Ceiling fan:12',
    'Smoke detector:10', 'CO detector:7', 'Water leak sensor:8',
  ]],
  ['outdoor', 'Outdoor', null, [
    'Lawn mower:10', 'Snow blower:12', 'Irrigation system:20', 'Pool equipment:10',
    'Shed:25', 'Outdoor lighting:12',
  ]],
  ['electronics', 'Electronics', null, [
    'Network equipment:7', 'Server/NAS:7', 'TV:8', 'Security camera:7',
  ]],
  ['vehicles', 'Vehicles', null, ['Car:15', 'Bicycle:15', 'E-bike:8']],
];

interface TemplateSeed {
  category: string; title: string; mode: 'fixed' | 'floating';
  rrule?: string; every?: Record<string, number>;
  estimateMin?: number; diy?: boolean; seasons?: string[];
  description?: string; checklist?: string[];
  consumables?: Array<{ name: string; quantity: number; unit: string }>;
}

const MAINTENANCE_TEMPLATES: TemplateSeed[] = [
  { category: 'furnace', title: 'Replace air filter', mode: 'floating', every: { days: 90 }, estimateMin: 10,
    description: 'Swap the return-air filter. Note the size on the old one before you throw it out.',
    consumables: [{ name: 'Furnace filter', quantity: 1, unit: 'ea' }] },
  { category: 'furnace', title: 'Professional tune-up', mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=10', diy: false, estimateMin: 90, seasons: ['fall'] },
  { category: 'heat-pump', title: 'Replace air filter', mode: 'floating', every: { days: 90 }, estimateMin: 10 },
  { category: 'air-conditioner', title: 'Clean condenser coils and check refrigerant', mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=4', estimateMin: 60, seasons: ['spring'] },
  { category: 'water-heater', title: 'Flush the tank', mode: 'fixed', rrule: 'FREQ=YEARLY', estimateMin: 60,
    checklist: ['Shut off power or gas', 'Attach hose to drain valve', 'Drain until clear', 'Refill before restoring power'] },
  { category: 'water-heater', title: 'Test the temperature and pressure valve', mode: 'fixed', rrule: 'FREQ=YEARLY', estimateMin: 15 },
  { category: 'water-heater', title: 'Inspect the anode rod', mode: 'fixed', rrule: 'FREQ=YEARLY;INTERVAL=3', estimateMin: 60 },
  { category: 'sump-pump', title: 'Test operation', mode: 'fixed', rrule: 'FREQ=MONTHLY;INTERVAL=3', estimateMin: 10,
    checklist: ['Pour a bucket of water into the pit', 'Confirm the float rises and the pump runs', 'Confirm it shuts off'] },
  { category: 'water-softener', title: 'Check the salt level', mode: 'fixed', rrule: 'FREQ=MONTHLY', estimateMin: 5,
    consumables: [{ name: 'Water softener salt', quantity: 1, unit: 'bag' }] },
  { category: 'refrigerator', title: 'Clean the condenser coils', mode: 'fixed', rrule: 'FREQ=MONTHLY;INTERVAL=6', estimateMin: 20 },
  { category: 'refrigerator', title: 'Replace the water filter', mode: 'floating', every: { months: 6 }, estimateMin: 10,
    consumables: [{ name: 'Fridge water filter', quantity: 1, unit: 'ea' }] },
  { category: 'dryer', title: 'Clean the vent duct', mode: 'fixed', rrule: 'FREQ=YEARLY', estimateMin: 45 },
  { category: 'dishwasher', title: 'Clean the filter', mode: 'fixed', rrule: 'FREQ=MONTHLY', estimateMin: 10 },
  { category: 'range-hood', title: 'Clean or replace the grease filter', mode: 'fixed', rrule: 'FREQ=MONTHLY;INTERVAL=3', estimateMin: 15 },
  { category: 'smoke-detector', title: 'Test', mode: 'fixed', rrule: 'FREQ=MONTHLY', estimateMin: 5 },
  { category: 'smoke-detector', title: 'Replace batteries', mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=11', estimateMin: 15, seasons: ['fall'],
    consumables: [{ name: '9V battery', quantity: 2, unit: 'ea' }] },
  { category: 'smoke-detector', title: 'Replace the unit', mode: 'fixed', rrule: 'FREQ=YEARLY;INTERVAL=10', estimateMin: 20 },
  { category: 'co-detector', title: 'Test', mode: 'fixed', rrule: 'FREQ=MONTHLY', estimateMin: 5 },
  { category: 'gutters', title: 'Clean', mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=4,10;BYMONTHDAY=15', estimateMin: 120, seasons: ['spring', 'fall'] },
  { category: 'roof', title: 'Visual inspection', mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=4', estimateMin: 30, seasons: ['spring'] },
  { category: 'garage-door', title: 'Lubricate and test auto-reverse', mode: 'fixed', rrule: 'FREQ=MONTHLY;INTERVAL=6', estimateMin: 20 },
  { category: 'septic-system', title: 'Pump the tank', mode: 'fixed', rrule: 'FREQ=YEARLY;INTERVAL=3', diy: false, estimateMin: 120 },
  { category: 'well-pump', title: 'Water quality test', mode: 'fixed', rrule: 'FREQ=YEARLY', estimateMin: 30 },
  { category: 'chimney', title: 'Inspect and sweep', mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=9', diy: false, estimateMin: 90, seasons: ['fall'] },
  { category: 'irrigation-system', title: 'Winterise', mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=10', estimateMin: 60, seasons: ['fall'] },
  { category: 'irrigation-system', title: 'Spring start-up', mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=4', estimateMin: 60, seasons: ['spring'] },
  { category: 'lawn-mower', title: 'Oil change and blade sharpen', mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=4', estimateMin: 60, seasons: ['spring'],
    consumables: [{ name: 'Small engine oil', quantity: 1, unit: 'bottle' }] },
  { category: 'snow-blower', title: 'Pre-season service', mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=11', estimateMin: 45, seasons: ['fall'] },
  { category: 'property', title: 'Test GFCI outlets', mode: 'fixed', rrule: 'FREQ=MONTHLY', estimateMin: 10 },
  { category: 'property', title: 'Check under every sink for leaks', mode: 'fixed', rrule: 'FREQ=MONTHLY;INTERVAL=3', estimateMin: 15 },
  { category: 'property', title: 'Reverse the ceiling fans', mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=4,10;BYMONTHDAY=1', estimateMin: 15, seasons: ['spring', 'fall'] },
  { category: 'property', title: 'Spring opening checklist', mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=4;BYMONTHDAY=1', estimateMin: 180, seasons: ['spring'],
    checklist: ['Open exterior taps', 'Inspect the roof and gutters', 'Service the mower', 'Check window screens', 'Reseal the deck if needed', 'Clean the AC condenser'] },
  { category: 'property', title: 'Winterisation checklist', mode: 'fixed', rrule: 'FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=15', estimateMin: 180, seasons: ['fall'],
    checklist: ['Shut off and drain exterior taps', 'Winterise irrigation', 'Service the furnace', 'Check weather stripping', 'Reverse ceiling fans', 'Stock ice melt'] },
];

const BUDGET_CATEGORIES: Array<[string, string[], 'expense' | 'income']> = [
  ['Income', ['Salary', 'Other income', 'Reimbursements', 'Sale proceeds'], 'income'],
  ['Housing', ['Mortgage/Rent', 'Property tax', 'Home insurance', 'HOA'], 'expense'],
  ['Utilities', ['Electricity', 'Gas/Heating', 'Water/Sewer', 'Trash', 'Internet', 'Phone'], 'expense'],
  ['Home', ['Maintenance', 'Repairs', 'Improvements', 'Furnishings', 'Tools', 'Cleaning supplies', 'Yard & garden'], 'expense'],
  ['Food', ['Groceries', 'Dining out', 'Household consumables'], 'expense'],
  ['Pets', ['Pet food', 'Vet', 'Pet medications', 'Pet insurance', 'Pet supplies', 'Boarding & sitting'], 'expense'],
  ['Transport', ['Fuel', 'Vehicle maintenance', 'Vehicle insurance', 'Parking & transit'], 'expense'],
  ['Personal', ['Health', 'Clothing', 'Subscriptions', 'Gifts', 'Entertainment'], 'expense'],
  ['Savings', ['Emergency fund', 'Home fund', 'Other goals'], 'expense'],
];

const PRODUCT_CATEGORIES: Array<[string, string[], boolean]> = [
  ['Produce', [], true],
  ['Dairy & eggs', [], true],
  ['Meat & seafood', [], true],
  ['Bakery', [], true],
  ['Pantry staples', ['Grains', 'Pasta', 'Canned goods', 'Baking', 'Oils & vinegars', 'Spices', 'Condiments'], true],
  ['Frozen', [], true],
  ['Beverages', [], true],
  ['Snacks', [], true],
  ['Pet food & supplies', ['Cat food wet', 'Cat food dry', 'Treats', 'Litter', 'Pet medications'], false],
  ['Household', ['Paper goods', 'Cleaning', 'Laundry', 'Batteries', 'Light bulbs', 'Filters'], false],
  ['Personal care', [], false],
  ['Hardware consumables', ['Fasteners', 'Adhesives', 'Tape', 'Sandpaper', 'Blades & bits'], false],
];

const STORAGE_CATEGORIES = [
  'Seasonal', 'Camping', 'Sports', 'Electronics', 'Cables & adapters', 'Spare parts',
  'Keepsakes', 'Documents', 'Clothing', 'Craft', 'Garden', 'Auto', 'Renovation leftovers',
];

const CAT_PROFILE = {
  code: 'cat',
  name: 'Cat',
  labels: { singular: 'Cat', plural: 'Cats', young: 'Kitten' },
  vaccinePresets: [
    { name: 'FVRCP', core: true, intervalMonths: 36, note: 'Kitten series, then 1 year, then every 3 years' },
    { name: 'Rabies', core: true, intervalMonths: 36, note: 'Follow local law: 1 or 3 years' },
    { name: 'FeLV', core: false, intervalMonths: 12, note: 'Yearly for cats that go outside' },
  ],
  journalTags: [
    'Vomiting', 'Diarrhea', 'Constipation', 'Appetite up', 'Appetite down', 'Thirst up',
    'Lethargy', 'Hiding', 'Limping', 'Sneezing', 'Coughing', 'Scratching', 'Hairballs',
    'Litter box avoidance', 'Aggression', 'Vocalising', 'Grooming change',
  ],
  commonConditions: [
    'Chronic kidney disease', 'Hyperthyroidism', 'Diabetes', 'Dental disease',
    'FLUTD', 'IBD', 'Obesity', 'Arthritis', 'Asthma',
  ],
  labTests: [
    { name: 'Creatinine', unit: 'mg/dL', refLow: 0.8, refHigh: 2.4 },
    { name: 'BUN', unit: 'mg/dL', refLow: 16, refHigh: 36 },
    { name: 'SDMA', unit: 'µg/dL', refLow: 0, refHigh: 14 },
    { name: 'Phosphorus', unit: 'mg/dL', refLow: 3.1, refHigh: 7.5 },
    { name: 'T4', unit: 'µg/dL', refLow: 0.8, refHigh: 4.0 },
    { name: 'Glucose', unit: 'mg/dL', refLow: 74, refHigh: 159 },
    { name: 'Fructosamine', unit: 'µmol/L', refLow: 191, refHigh: 349 },
    { name: 'ALT', unit: 'U/L', refLow: 12, refHigh: 130 },
    { name: 'Hematocrit', unit: '%', refLow: 30, refHigh: 45 },
    { name: 'Urine specific gravity', unit: '', refLow: 1.035, refHigh: 1.06 },
  ],
  weightWarnPct: 10,
};

const PROJECT_TEMPLATES = [
  {
    name: 'Bathroom remodel',
    descriptionMd: 'Full gut and refit of a bathroom, from demolition through final fixtures.',
    phases: [
      { name: 'Demo', tasks: ['Protect floors and hallway', 'Remove fixtures', 'Remove tile and drywall', 'Haul debris'] },
      { name: 'Rough-in', tasks: ['Rough plumbing', 'Rough electrical', 'Move or add vent fan', 'Insulate exterior wall'] },
      { name: 'Inspection', tasks: ['Book rough inspection', 'Address inspector notes'] },
      { name: 'Tile', tasks: ['Hang cement board', 'Waterproof shower', 'Set floor tile', 'Set wall tile', 'Grout and seal'] },
      { name: 'Finish', tasks: ['Hang and finish drywall', 'Paint', 'Set vanity and toilet', 'Install fixtures and trim', 'Final clean'] },
    ],
    materials: [
      { description: 'Floor tile', quantity: 60, unit: 'ea' },
      { description: 'Wall tile', quantity: 120, unit: 'ea' },
      { description: 'Cement board', quantity: 8, unit: 'ea' },
      { description: 'Waterproofing membrane', quantity: 1, unit: 'ea' },
      { description: 'Thinset', quantity: 4, unit: 'bag' },
      { description: 'Grout', quantity: 2, unit: 'bag' },
      { description: 'Vanity', quantity: 1, unit: 'ea' },
      { description: 'Toilet', quantity: 1, unit: 'ea' },
      { description: 'Shower valve and trim', quantity: 1, unit: 'ea' },
      { description: 'Exhaust fan', quantity: 1, unit: 'ea' },
    ],
    tools: ['Wet tile saw', 'Oscillating multi-tool', 'Tile trowel set'],
    permits: ['Plumbing permit', 'Electrical permit'],
    budgetBreakdown: { materials: 450000, labour: 500000, permits: 40000, tools: 30000, disposal: 40000, contingency: 140000 },
  },
  {
    name: 'Interior repaint (one room)',
    descriptionMd: 'Prep, prime and paint a single room.',
    phases: [
      { name: 'Prep', tasks: ['Move and cover furniture', 'Patch and sand', 'Caulk trim gaps', 'Mask and tape'] },
      { name: 'Paint', tasks: ['Cut in ceiling', 'Roll ceiling', 'Cut in walls', 'Roll walls, two coats', 'Paint trim'] },
      { name: 'Finish', tasks: ['Remove tape', 'Touch up', 'Clean brushes and rollers', 'Replace outlet covers'] },
    ],
    materials: [
      { description: 'Wall paint', quantity: 2, unit: 'gal' },
      { description: 'Ceiling paint', quantity: 1, unit: 'gal' },
      { description: 'Primer', quantity: 1, unit: 'gal' },
      { description: 'Painter tape', quantity: 2, unit: 'roll' },
      { description: 'Drop cloths', quantity: 2, unit: 'ea' },
    ],
    tools: ['Extension pole', 'Roller frame', 'Angled sash brush'],
    permits: [],
    budgetBreakdown: { materials: 20000, labour: 0, contingency: 5000 },
  },
  {
    name: 'Deck build',
    descriptionMd: 'Ground-level deck from footings to railing.',
    phases: [
      { name: 'Planning', tasks: ['Measure and draw the plan', 'Check setbacks', 'Apply for permit', 'Call before you dig'] },
      { name: 'Footings', tasks: ['Lay out and dig footings', 'Pour concrete', 'Set post bases', 'Footing inspection'] },
      { name: 'Frame', tasks: ['Set posts and beams', 'Hang joists', 'Install blocking', 'Framing inspection'] },
      { name: 'Deck', tasks: ['Lay decking', 'Cut and trim edges', 'Build stairs', 'Install railing'] },
      { name: 'Finish', tasks: ['Sand and clean', 'Seal or stain', 'Final inspection'] },
    ],
    materials: [
      { description: 'Concrete mix', quantity: 12, unit: 'bag' },
      { description: 'Post base hardware', quantity: 6, unit: 'ea' },
      { description: '6x6 posts', quantity: 6, unit: 'ea' },
      { description: '2x8 joists', quantity: 24, unit: 'ea' },
      { description: 'Joist hangers', quantity: 48, unit: 'ea' },
      { description: 'Decking boards', quantity: 60, unit: 'ea' },
      { description: 'Structural screws', quantity: 5, unit: 'box' },
      { description: 'Railing kit', quantity: 1, unit: 'ea' },
    ],
    tools: ['Circular saw', 'Impact driver', 'Post hole digger', 'Laser level'],
    permits: ['Building permit'],
    budgetBreakdown: { materials: 350000, labour: 0, permits: 25000, tools: 20000, contingency: 60000 },
  },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function isEmpty(db: DB, table: any): Promise<boolean> {
  const r = await db.select({ n: sql<number>`count(*)` }).from(table);
  return Number(r[0]?.n ?? 0) === 0;
}

export async function seedDefaults(db: DB): Promise<{ seeded: string[] }> {
  const seeded: string[] = [];

  if (await isEmpty(db, assetCategories)) {
    for (const [parentSlug, name, , children] of ASSET_CATEGORIES) {
      const [parent] = await db.insert(assetCategories)
        .values({ name, slug: parentSlug }).returning();
      for (const child of children) {
        const [childName, life] = child.split(':');
        await db.insert(assetCategories).values({
          name: childName!, slug: slug(childName!), parentId: parent!.id,
          defaultLifespanYears: life ? Number(life) : null,
        }).onConflictDoNothing();
      }
    }
    seeded.push('assetCategories');
  }

  if (await isEmpty(db, maintenanceTemplates)) {
    for (const t of MAINTENANCE_TEMPLATES) {
      await db.insert(maintenanceTemplates).values({
        categorySlug: t.category, title: t.title, descriptionMd: t.description ?? null,
        mode: t.mode, rrule: t.rrule ?? null, every: t.every ?? null,
        estimateMin: t.estimateMin ?? null, diy: t.diy ?? true,
        seasonTags: t.seasons ?? null, checklist: t.checklist ?? null,
        consumables: t.consumables ?? null,
      });
    }
    seeded.push('maintenanceTemplates');
  }

  if (await isEmpty(db, categories)) {
    for (const [parentName, children, kind] of BUDGET_CATEGORIES) {
      const [parent] = await db.insert(categories).values({ name: parentName, kind }).returning();
      for (const [i, child] of children.entries()) {
        await db.insert(categories).values({ name: child, kind, parentId: parent!.id, sort: i });
      }
    }
    seeded.push('budgetCategories');
  }

  if (await isEmpty(db, productCategories)) {
    for (const [parentName, children, isFood] of PRODUCT_CATEGORIES) {
      const parentSlug = slug(parentName);
      const [parent] = await db.insert(productCategories).values({
        name: parentName, slug: parentSlug, isFood,
        emissionFactorKey: PRODUCT_CATEGORY_FACTORS[parentSlug] ?? null,
      }).returning();
      for (const [i, child] of children.entries()) {
        const childSlug = slug(child);
        await db.insert(productCategories).values({
          name: child, slug: childSlug, parentId: parent!.id, isFood, sort: i,
          emissionFactorKey: PRODUCT_CATEGORY_FACTORS[childSlug] ?? null,
        });
      }
    }
    seeded.push('productCategories');
  }

  if (await isEmpty(db, emissionFactors)) {
    for (const f of FACTOR_SEEDS) {
      await db.insert(emissionFactors).values({
        key: f.key, name: f.name, category: f.category,
        activityUnit: f.activityUnit, kgPerUnit: f.kgPerUnit, scope: f.scope,
        region: f.region ?? null, source: f.source, confidence: f.confidence,
        notes: f.notes ?? null, isDefault: true,
      });
    }
    seeded.push('emissionFactors');
  }

  if (await isEmpty(db, interventionTemplates)) {
    for (const i of INTERVENTION_TEMPLATES) {
      await db.insert(interventionTemplates).values({
        key: i.key, name: i.name, category: i.category, descriptionMd: i.descriptionMd,
        typicalCost: i.typicalCost, embodiedGCo2e: i.embodiedGCo2e,
        lifetimeYears: i.lifetimeYears, savingModel: i.savingModel,
      });
    }
    seeded.push('interventionTemplates');
  }

  if (await isEmpty(db, storageCategories)) {
    for (const [i, name] of STORAGE_CATEGORIES.entries()) {
      await db.insert(storageCategories).values({ name, slug: slug(name), sort: i });
    }
    seeded.push('storageCategories');
  }

  const cat = await db.select().from(speciesProfiles).where(eq(speciesProfiles.code, 'cat')).limit(1);
  if (!cat.length) {
    await db.insert(speciesProfiles).values(CAT_PROFILE as any);
    seeded.push('speciesProfiles');
  }

  if (await isEmpty(db, projectTemplates)) {
    for (const t of PROJECT_TEMPLATES) {
      await db.insert(projectTemplates).values(t as any);
    }
    seeded.push('projectTemplates');
  }

  return { seeded };
}
