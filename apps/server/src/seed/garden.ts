/**
 * Shipped garden and compost libraries (GARD-007, COMP-003).
 *
 * Like the emission factors, these are a starting point rather than an
 * authority. Days to maturity vary by a fortnight between seed houses, and
 * every C:N ratio in print is a range quoted as a number. They are here so the
 * first season is usable without typing a catalogue in.
 */

export interface VarietySeed {
  name: string;
  cultivar?: string;
  family: string;
  species?: string;
  category: 'vegetable' | 'herb' | 'fruit' | 'flower';
  daysToMaturity: number;
  sowDepthIn?: number;
  spacingIn?: number;
  sun?: string;
  frostHardy?: boolean;
  perennial?: boolean;
  openPollinated?: boolean;
  seedViabilityYears: number;
  indoorWeeks?: number;
  sowWindow?: { anchor: 'last_spring' | 'first_autumn'; startWeeks: number; endWeeks: number; method?: string };
  emissionFactorKey?: string;
  typicalPrice?: number;
  typicalPriceUnit?: string;
  yieldPerPlantLb?: number;
  notes?: string;
}

const SPRING = 'last_spring' as const;
const AUTUMN = 'first_autumn' as const;

/**
 * Seed viability years are the honest short numbers, not the optimistic ones:
 * parsnip and onion really are done after a year or two, whatever the packet
 * says, and a household is better served by being told to test than by being
 * told to hope.
 */
export const VARIETY_SEEDS: VarietySeed[] = [
  /* ── Solanaceae: the rotation family that catches everyone out ── */
  { name: 'Tomato', cultivar: 'Amish Paste', family: 'Solanaceae', species: 'Solanum lycopersicum',
    category: 'vegetable', daysToMaturity: 80, sowDepthIn: 0.25, spacingIn: 24, sun: 'full',
    seedViabilityYears: 5, indoorWeeks: 6, openPollinated: true,
    sowWindow: { anchor: SPRING, startWeeks: -8, endWeeks: -4, method: 'indoor' },
    emissionFactorKey: 'food.vegetables', typicalPrice: 280, typicalPriceUnit: 'lb', yieldPerPlantLb: 8,
    notes: 'Open-pollinated paste tomato, so seed saved from it comes true.' },
  { name: 'Tomato', cultivar: 'Sungold', family: 'Solanaceae', species: 'Solanum lycopersicum',
    category: 'vegetable', daysToMaturity: 65, sowDepthIn: 0.25, spacingIn: 24, sun: 'full',
    seedViabilityYears: 5, indoorWeeks: 6, openPollinated: false,
    sowWindow: { anchor: SPRING, startWeeks: -8, endWeeks: -4, method: 'indoor' },
    emissionFactorKey: 'food.vegetables', typicalPrice: 400, typicalPriceUnit: 'lb', yieldPerPlantLb: 6,
    notes: 'An F1 hybrid: saved seed will not come true, and the app will say so if you try.' },
  { name: 'Pepper', cultivar: 'Jalapeño', family: 'Solanaceae', category: 'vegetable',
    daysToMaturity: 75, sowDepthIn: 0.25, spacingIn: 18, sun: 'full', seedViabilityYears: 3, indoorWeeks: 8,
    sowWindow: { anchor: SPRING, startWeeks: -10, endWeeks: -6, method: 'indoor' },
    emissionFactorKey: 'food.vegetables', typicalPrice: 350, typicalPriceUnit: 'lb', yieldPerPlantLb: 2 },
  { name: 'Potato', family: 'Solanaceae', category: 'vegetable', daysToMaturity: 90,
    sowDepthIn: 4, spacingIn: 12, sun: 'full', seedViabilityYears: 1,
    sowWindow: { anchor: SPRING, startWeeks: -2, endWeeks: 4, method: 'direct' },
    emissionFactorKey: 'food.potatoes', typicalPrice: 120, typicalPriceUnit: 'lb', yieldPerPlantLb: 3 },
  { name: 'Aubergine', cultivar: 'Black Beauty', family: 'Solanaceae', category: 'vegetable',
    daysToMaturity: 80, spacingIn: 24, sun: 'full', seedViabilityYears: 4, indoorWeeks: 8,
    sowWindow: { anchor: SPRING, startWeeks: -10, endWeeks: -6, method: 'indoor' },
    emissionFactorKey: 'food.vegetables', typicalPrice: 300, typicalPriceUnit: 'lb', yieldPerPlantLb: 4 },

  /* ── Brassicaceae ── */
  { name: 'Kale', cultivar: 'Lacinato', family: 'Brassicaceae', category: 'vegetable',
    daysToMaturity: 60, sowDepthIn: 0.5, spacingIn: 18, sun: 'full', frostHardy: true,
    seedViabilityYears: 4, indoorWeeks: 5,
    sowWindow: { anchor: SPRING, startWeeks: -6, endWeeks: 6 },
    emissionFactorKey: 'food.vegetables', typicalPrice: 400, typicalPriceUnit: 'lb', yieldPerPlantLb: 2 },
  { name: 'Broccoli', family: 'Brassicaceae', category: 'vegetable', daysToMaturity: 70,
    sowDepthIn: 0.5, spacingIn: 18, sun: 'full', frostHardy: true, seedViabilityYears: 4, indoorWeeks: 5,
    sowWindow: { anchor: SPRING, startWeeks: -6, endWeeks: -2, method: 'indoor' },
    emissionFactorKey: 'food.vegetables', typicalPrice: 250, typicalPriceUnit: 'lb', yieldPerPlantLb: 1.5 },
  { name: 'Radish', cultivar: 'French Breakfast', family: 'Brassicaceae', category: 'vegetable',
    daysToMaturity: 25, sowDepthIn: 0.5, spacingIn: 2, sun: 'full', frostHardy: true, seedViabilityYears: 4,
    sowWindow: { anchor: SPRING, startWeeks: -4, endWeeks: 8, method: 'direct' },
    emissionFactorKey: 'food.vegetables', typicalPrice: 300, typicalPriceUnit: 'lb', yieldPerPlantLb: 0.1,
    notes: 'Fast enough to sow in succession all season, and the classic gap-filler.' },
  { name: 'Rocket', family: 'Brassicaceae', category: 'vegetable', daysToMaturity: 30,
    sowDepthIn: 0.25, spacingIn: 4, frostHardy: true, seedViabilityYears: 4,
    sowWindow: { anchor: SPRING, startWeeks: -4, endWeeks: 10, method: 'direct' },
    emissionFactorKey: 'food.vegetables', typicalPrice: 800, typicalPriceUnit: 'lb', yieldPerPlantLb: 0.2 },
  { name: 'Cabbage', family: 'Brassicaceae', category: 'vegetable', daysToMaturity: 85,
    spacingIn: 18, frostHardy: true, seedViabilityYears: 4, indoorWeeks: 5,
    sowWindow: { anchor: SPRING, startWeeks: -6, endWeeks: -2, method: 'indoor' },
    emissionFactorKey: 'food.vegetables', typicalPrice: 100, typicalPriceUnit: 'lb', yieldPerPlantLb: 3 },

  /* ── Cucurbitaceae ── */
  { name: 'Courgette', cultivar: 'Black Beauty', family: 'Cucurbitaceae', category: 'vegetable',
    daysToMaturity: 50, sowDepthIn: 1, spacingIn: 36, sun: 'full', seedViabilityYears: 5, indoorWeeks: 3,
    sowWindow: { anchor: SPRING, startWeeks: 0, endWeeks: 6, method: 'direct' },
    emissionFactorKey: 'food.vegetables', typicalPrice: 200, typicalPriceUnit: 'lb', yieldPerPlantLb: 10,
    notes: 'One plant is generous. Two is a problem you will be giving to neighbours.' },
  { name: 'Cucumber', family: 'Cucurbitaceae', category: 'vegetable', daysToMaturity: 55,
    sowDepthIn: 1, spacingIn: 12, sun: 'full', seedViabilityYears: 5, indoorWeeks: 3,
    sowWindow: { anchor: SPRING, startWeeks: 0, endWeeks: 6 },
    emissionFactorKey: 'food.vegetables', typicalPrice: 200, typicalPriceUnit: 'lb', yieldPerPlantLb: 6 },
  { name: 'Winter squash', cultivar: 'Butternut', family: 'Cucurbitaceae', category: 'vegetable',
    daysToMaturity: 100, sowDepthIn: 1, spacingIn: 48, sun: 'full', seedViabilityYears: 5,
    sowWindow: { anchor: SPRING, startWeeks: 0, endWeeks: 4, method: 'direct' },
    emissionFactorKey: 'food.vegetables', typicalPrice: 150, typicalPriceUnit: 'lb', yieldPerPlantLb: 12 },

  /* ── Fabaceae: the family that gives nitrogen back ── */
  { name: 'Bush bean', family: 'Fabaceae', category: 'vegetable', daysToMaturity: 55,
    sowDepthIn: 1, spacingIn: 4, sun: 'full', seedViabilityYears: 3,
    sowWindow: { anchor: SPRING, startWeeks: 0, endWeeks: 8, method: 'direct' },
    emissionFactorKey: 'food.legumes', typicalPrice: 350, typicalPriceUnit: 'lb', yieldPerPlantLb: 0.5,
    notes: 'Fixes nitrogen, so it is a good follower for a hungry brassica bed.' },
  { name: 'Pea', cultivar: 'Sugar Snap', family: 'Fabaceae', category: 'vegetable',
    daysToMaturity: 60, sowDepthIn: 1, spacingIn: 3, frostHardy: true, seedViabilityYears: 3,
    sowWindow: { anchor: SPRING, startWeeks: -6, endWeeks: 0, method: 'direct' },
    emissionFactorKey: 'food.legumes', typicalPrice: 400, typicalPriceUnit: 'lb', yieldPerPlantLb: 0.3 },
  { name: 'Runner bean', family: 'Fabaceae', category: 'vegetable', daysToMaturity: 70,
    sowDepthIn: 2, spacingIn: 8, sun: 'full', seedViabilityYears: 3,
    sowWindow: { anchor: SPRING, startWeeks: 0, endWeeks: 5, method: 'direct' },
    emissionFactorKey: 'food.legumes', typicalPrice: 350, typicalPriceUnit: 'lb', yieldPerPlantLb: 2 },

  /* ── Apiaceae ── */
  { name: 'Carrot', cultivar: 'Nantes', family: 'Apiaceae', category: 'vegetable',
    daysToMaturity: 70, sowDepthIn: 0.25, spacingIn: 2, frostHardy: true, seedViabilityYears: 3,
    sowWindow: { anchor: SPRING, startWeeks: -3, endWeeks: 8, method: 'direct' },
    emissionFactorKey: 'food.potatoes', typicalPrice: 120, typicalPriceUnit: 'lb', yieldPerPlantLb: 0.2 },
  { name: 'Parsnip', family: 'Apiaceae', category: 'vegetable', daysToMaturity: 120,
    sowDepthIn: 0.5, spacingIn: 4, frostHardy: true, seedViabilityYears: 1,
    sowWindow: { anchor: SPRING, startWeeks: -2, endWeeks: 4, method: 'direct' },
    emissionFactorKey: 'food.potatoes', typicalPrice: 180, typicalPriceUnit: 'lb', yieldPerPlantLb: 0.5,
    notes: 'Parsnip seed is genuinely dead after a year. Buy it fresh or test it; do not trust the packet.' },
  { name: 'Parsley', family: 'Apiaceae', category: 'herb', daysToMaturity: 75,
    spacingIn: 8, frostHardy: true, seedViabilityYears: 2, indoorWeeks: 6,
    sowWindow: { anchor: SPRING, startWeeks: -8, endWeeks: 4 },
    emissionFactorKey: 'food.vegetables', typicalPrice: 1200, typicalPriceUnit: 'lb', yieldPerPlantLb: 0.3 },

  /* ── Amaryllidaceae, Asteraceae, Chenopodiaceae ── */
  { name: 'Onion', family: 'Amaryllidaceae', category: 'vegetable', daysToMaturity: 100,
    sowDepthIn: 0.5, spacingIn: 4, seedViabilityYears: 1, indoorWeeks: 10,
    sowWindow: { anchor: SPRING, startWeeks: -12, endWeeks: -6, method: 'indoor' },
    emissionFactorKey: 'food.vegetables', typicalPrice: 130, typicalPriceUnit: 'lb', yieldPerPlantLb: 0.4,
    notes: 'Like parsnip, onion seed does not keep. One year, and then test it.' },
  { name: 'Garlic', family: 'Amaryllidaceae', category: 'vegetable', daysToMaturity: 240,
    sowDepthIn: 2, spacingIn: 6, frostHardy: true, seedViabilityYears: 1,
    sowWindow: { anchor: AUTUMN, startWeeks: -4, endWeeks: 2, method: 'direct' },
    emissionFactorKey: 'food.vegetables', typicalPrice: 600, typicalPriceUnit: 'lb', yieldPerPlantLb: 0.15,
    notes: 'Planted in autumn from cloves of the last crop — the simplest circular loop in the garden.' },
  { name: 'Lettuce', cultivar: 'Little Gem', family: 'Asteraceae', category: 'vegetable',
    daysToMaturity: 50, sowDepthIn: 0.25, spacingIn: 8, frostHardy: true, seedViabilityYears: 3, indoorWeeks: 4,
    sowWindow: { anchor: SPRING, startWeeks: -5, endWeeks: 10 },
    emissionFactorKey: 'food.vegetables', typicalPrice: 400, typicalPriceUnit: 'lb', yieldPerPlantLb: 0.6,
    notes: 'The succession crop. Sow a short row every fortnight rather than a long one in May.' },
  { name: 'Chard', cultivar: 'Rainbow', family: 'Chenopodiaceae', category: 'vegetable',
    daysToMaturity: 55, sowDepthIn: 0.5, spacingIn: 10, frostHardy: true, seedViabilityYears: 4,
    sowWindow: { anchor: SPRING, startWeeks: -3, endWeeks: 10, method: 'direct' },
    emissionFactorKey: 'food.vegetables', typicalPrice: 400, typicalPriceUnit: 'lb', yieldPerPlantLb: 2 },
  { name: 'Beetroot', family: 'Chenopodiaceae', category: 'vegetable', daysToMaturity: 55,
    sowDepthIn: 0.5, spacingIn: 4, frostHardy: true, seedViabilityYears: 4,
    sowWindow: { anchor: SPRING, startWeeks: -3, endWeeks: 8, method: 'direct' },
    emissionFactorKey: 'food.potatoes', typicalPrice: 200, typicalPriceUnit: 'lb', yieldPerPlantLb: 0.3 },
  { name: 'Spinach', family: 'Chenopodiaceae', category: 'vegetable', daysToMaturity: 40,
    sowDepthIn: 0.5, spacingIn: 4, frostHardy: true, seedViabilityYears: 3,
    sowWindow: { anchor: SPRING, startWeeks: -6, endWeeks: 2, method: 'direct' },
    emissionFactorKey: 'food.vegetables', typicalPrice: 500, typicalPriceUnit: 'lb', yieldPerPlantLb: 0.4 },

  /* ── herbs and perennials ── */
  { name: 'Basil', family: 'Lamiaceae', category: 'herb', daysToMaturity: 60, spacingIn: 10,
    sun: 'full', seedViabilityYears: 5, indoorWeeks: 5,
    sowWindow: { anchor: SPRING, startWeeks: -6, endWeeks: 4 },
    emissionFactorKey: 'food.vegetables', typicalPrice: 1600, typicalPriceUnit: 'lb', yieldPerPlantLb: 0.3 },
  { name: 'Thyme', family: 'Lamiaceae', category: 'herb', daysToMaturity: 90, spacingIn: 12,
    perennial: true, frostHardy: true, seedViabilityYears: 3,
    emissionFactorKey: 'food.vegetables', typicalPrice: 2000, typicalPriceUnit: 'lb', yieldPerPlantLb: 0.2 },
  { name: 'Rhubarb', family: 'Polygonaceae', category: 'fruit', daysToMaturity: 365, spacingIn: 36,
    perennial: true, frostHardy: true, seedViabilityYears: 2,
    emissionFactorKey: 'food.fruit', typicalPrice: 300, typicalPriceUnit: 'lb', yieldPerPlantLb: 5,
    notes: 'Perennial: plant once, then leave it alone for a year before taking anything.' },
  { name: 'Strawberry', family: 'Rosaceae', category: 'fruit', daysToMaturity: 120, spacingIn: 12,
    perennial: true, frostHardy: true, seedViabilityYears: 2,
    emissionFactorKey: 'food.fruit', typicalPrice: 500, typicalPriceUnit: 'lb', yieldPerPlantLb: 1 },
];

export interface CompostMaterialSeed {
  key: string;
  name: string;
  cnRatio: number;
  kind: 'green' | 'brown';
  moisture?: string;
  acceptable?: boolean;
  caution?: string;
  source: string;
}

const CORNELL = 'Cornell Waste Management Institute composting tables (approximate ranges)';

/**
 * C:N ratios are all quoted ranges in the literature; these are middles. The
 * point is not the third significant figure, it is that sawdust and grass sit
 * two orders of magnitude apart and a pile balances between them.
 */
export const COMPOST_MATERIAL_SEEDS: CompostMaterialSeed[] = [
  /* greens: nitrogen */
  { key: 'kitchen_scraps', name: 'Kitchen scraps (fruit and vegetable)', cnRatio: 20, kind: 'green', moisture: 'wet', source: CORNELL },
  { key: 'coffee_grounds', name: 'Coffee grounds', cnRatio: 20, kind: 'green', moisture: 'wet', source: CORNELL },
  { key: 'grass_clippings', name: 'Grass clippings', cnRatio: 17, kind: 'green', moisture: 'wet', source: CORNELL },
  { key: 'garden_greens', name: 'Green garden waste', cnRatio: 30, kind: 'green', moisture: 'moist', source: CORNELL },
  { key: 'spent_plants', name: 'Spent plants from a bed', cnRatio: 35, kind: 'green', moisture: 'moist', source: CORNELL },
  { key: 'weeds', name: 'Weeds (not seeded)', cnRatio: 25, kind: 'green', moisture: 'moist', source: CORNELL,
    caution: 'Only before they set seed, unless the pile reliably reaches 140°F.' },
  { key: 'manure_chicken', name: 'Chicken manure', cnRatio: 7, kind: 'green', moisture: 'wet', source: CORNELL,
    caution: 'Very high in nitrogen. Needs a lot of browns with it.' },
  { key: 'manure_horse', name: 'Horse manure with bedding', cnRatio: 25, kind: 'green', moisture: 'moist', source: CORNELL },
  { key: 'seaweed', name: 'Seaweed', cnRatio: 19, kind: 'green', moisture: 'wet', source: CORNELL },
  { key: 'eggshells', name: 'Eggshells', cnRatio: 12, kind: 'green', moisture: 'dry', source: CORNELL,
    caution: 'Crush them, or they will still be recognisable in two years.' },

  /* browns: carbon */
  { key: 'dry_leaves', name: 'Dry leaves', cnRatio: 60, kind: 'brown', moisture: 'dry', source: CORNELL },
  { key: 'straw', name: 'Straw', cnRatio: 80, kind: 'brown', moisture: 'dry', source: CORNELL },
  { key: 'cardboard', name: 'Cardboard (plain, torn up)', cnRatio: 350, kind: 'brown', moisture: 'dry', source: CORNELL,
    caution: 'Plain brown only. No wax coating, no glossy print, and take the tape off.' },
  { key: 'paper', name: 'Newspaper and plain paper', cnRatio: 175, kind: 'brown', moisture: 'dry', source: CORNELL },
  { key: 'sawdust', name: 'Sawdust (untreated)', cnRatio: 400, kind: 'brown', moisture: 'dry', source: CORNELL,
    caution: 'Untreated timber only. Never from anything painted, glued or pressure-treated.' },
  { key: 'wood_chips', name: 'Wood chips', cnRatio: 400, kind: 'brown', moisture: 'dry', source: CORNELL },
  { key: 'hay', name: 'Hay', cnRatio: 40, kind: 'brown', moisture: 'dry', source: CORNELL },
  { key: 'pine_needles', name: 'Pine needles', cnRatio: 80, kind: 'brown', moisture: 'dry', source: CORNELL,
    caution: 'Slow to break down and acidifying in quantity. Fine as part of a mix.' },
  { key: 'wood_ash', name: 'Wood ash', cnRatio: 25, kind: 'brown', moisture: 'dry', source: CORNELL,
    caution: 'A light dusting only. It is alkaline and too much will stall the pile.' },

  /* things people ask about, and the answer is no */
  { key: 'meat', name: 'Meat and fish', cnRatio: 10, kind: 'green', acceptable: false, source: CORNELL,
    caution: 'Not in a domestic pile: it draws rats and rarely gets hot enough to be safe. Bokashi or the council collection.' },
  { key: 'dairy', name: 'Dairy', cnRatio: 10, kind: 'green', acceptable: false, source: CORNELL,
    caution: 'Same as meat — vermin, and it goes anaerobic and sour.' },
  { key: 'cooked_food', name: 'Cooked food with oil', cnRatio: 18, kind: 'green', acceptable: false, source: CORNELL,
    caution: 'The oil coats everything and keeps air out. Bokashi handles it; a heap does not.' },
  { key: 'pet_waste_cat', name: 'Cat litter and faeces', cnRatio: 12, kind: 'green', acceptable: false, source: CORNELL,
    caution: 'Never on a pile that feeds a vegetable garden. Toxoplasma survives ordinary composting.' },
  { key: 'diseased_plants', name: 'Diseased plant material', cnRatio: 30, kind: 'green', acceptable: false, source: CORNELL,
    caution: 'A cold pile will keep the pathogen and hand it back to you next season. Bin it or burn it.' },
];
