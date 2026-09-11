/** Unit parsing and conversion. Households mix metric and imperial freely and
 *  type things like "2.5 kg", "1 1/2 cups" or "16x25x1 in" into quantity boxes. */

export type Dimension = 'mass' | 'volume' | 'length' | 'count' | 'temperature' | 'time' | 'energy';

interface UnitDef { dim: Dimension; base: number; system: 'metric' | 'imperial' | 'any'; aliases: string[] }

/** base is the factor to the dimension's canonical unit:
 *  mass=gram, volume=millilitre, length=millimetre, count=each, time=minute. */
const UNITS: Record<string, UnitDef> = {
  mg: { dim: 'mass', base: 0.001, system: 'metric', aliases: ['milligram', 'milligrams'] },
  g: { dim: 'mass', base: 1, system: 'metric', aliases: ['gram', 'grams', 'gm'] },
  kg: { dim: 'mass', base: 1000, system: 'metric', aliases: ['kilogram', 'kilograms', 'kilo', 'kilos'] },
  oz: { dim: 'mass', base: 28.349523125, system: 'imperial', aliases: ['ounce', 'ounces'] },
  lb: { dim: 'mass', base: 453.59237, system: 'imperial', aliases: ['lbs', 'pound', 'pounds', '#'] },

  ml: { dim: 'volume', base: 1, system: 'metric', aliases: ['millilitre', 'milliliter', 'millilitres', 'milliliters', 'cc'] },
  l: { dim: 'volume', base: 1000, system: 'metric', aliases: ['litre', 'liter', 'litres', 'liters'] },
  tsp: { dim: 'volume', base: 4.92892159375, system: 'imperial', aliases: ['teaspoon', 'teaspoons'] },
  tbsp: { dim: 'volume', base: 14.78676478125, system: 'imperial', aliases: ['tablespoon', 'tablespoons', 'tbs'] },
  floz: { dim: 'volume', base: 29.5735295625, system: 'imperial', aliases: ['fl oz', 'fluid ounce', 'fluid ounces'] },
  cup: { dim: 'volume', base: 236.5882365, system: 'imperial', aliases: ['cups', 'c'] },
  pt: { dim: 'volume', base: 473.176473, system: 'imperial', aliases: ['pint', 'pints'] },
  qt: { dim: 'volume', base: 946.352946, system: 'imperial', aliases: ['quart', 'quarts'] },
  gal: { dim: 'volume', base: 3785.411784, system: 'imperial', aliases: ['gallon', 'gallons'] },
  m3: { dim: 'volume', base: 1_000_000, system: 'metric', aliases: ['cubic metre', 'cubic meter', 'cubic metres', 'cubic meters', 'm³', 'cbm'] },
  ft3: { dim: 'volume', base: 28316.846592, system: 'imperial', aliases: ['cubic foot', 'cubic feet', 'cf', 'ft³'] },

  mm: { dim: 'length', base: 1, system: 'metric', aliases: ['millimetre', 'millimeter', 'millimetres', 'millimeters'] },
  cm: { dim: 'length', base: 10, system: 'metric', aliases: ['centimetre', 'centimeter', 'centimetres', 'centimeters'] },
  m: { dim: 'length', base: 1000, system: 'metric', aliases: ['metre', 'meter', 'metres', 'meters'] },
  in: { dim: 'length', base: 25.4, system: 'imperial', aliases: ['inch', 'inches', '"'] },
  ft: { dim: 'length', base: 304.8, system: 'imperial', aliases: ['foot', 'feet', "'"] },
  yd: { dim: 'length', base: 914.4, system: 'imperial', aliases: ['yard', 'yards'] },

  ea: { dim: 'count', base: 1, system: 'any', aliases: ['each', 'unit', 'units', 'x', 'pc', 'pcs', 'piece', 'pieces', 'ct', 'count'] },
  pkg: { dim: 'count', base: 1, system: 'any', aliases: ['package', 'packages', 'pack', 'packs'] },
  can: { dim: 'count', base: 1, system: 'any', aliases: ['cans', 'tin', 'tins'] },
  box: { dim: 'count', base: 1, system: 'any', aliases: ['boxes'] },
  bag: { dim: 'count', base: 1, system: 'any', aliases: ['bags'] },
  bottle: { dim: 'count', base: 1, system: 'any', aliases: ['bottles', 'btl'] },
  dose: { dim: 'count', base: 1, system: 'any', aliases: ['doses', 'tablet', 'tablets', 'tab', 'tabs', 'capsule', 'capsules', 'pill', 'pills'] },
  roll: { dim: 'count', base: 1, system: 'any', aliases: ['rolls'] },

  min: { dim: 'time', base: 1, system: 'any', aliases: ['minute', 'minutes', 'mins'] },
  h: { dim: 'time', base: 60, system: 'any', aliases: ['hr', 'hrs', 'hour', 'hours'] },

  // Energy, canonical unit megajoule. Household meters read in kWh, therms or
  // ccf depending on the utility, and emission factors are published in all
  // three, so they have to be interconvertible rather than merely parallel.
  mj: { dim: 'energy', base: 1, system: 'any', aliases: ['megajoule', 'megajoules'] },
  kj: { dim: 'energy', base: 0.001, system: 'any', aliases: ['kilojoule', 'kilojoules'] },
  gj: { dim: 'energy', base: 1000, system: 'any', aliases: ['gigajoule', 'gigajoules'] },
  kwh: { dim: 'energy', base: 3.6, system: 'any', aliases: ['kilowatt hour', 'kilowatt-hour', 'kilowatt hours', 'kw h'] },
  mwh: { dim: 'energy', base: 3600, system: 'any', aliases: ['megawatt hour', 'megawatt hours'] },
  wh: { dim: 'energy', base: 0.0036, system: 'any', aliases: ['watt hour', 'watt hours'] },
  therm: { dim: 'energy', base: 105.4804, system: 'imperial', aliases: ['therms', 'thm'] },
  ccf: { dim: 'energy', base: 108.7, system: 'imperial', aliases: ['hundred cubic feet'] },
  btu: { dim: 'energy', base: 0.00105506, system: 'imperial', aliases: ['btus', 'british thermal unit'] },
  mmbtu: { dim: 'energy', base: 1055.06, system: 'imperial', aliases: ['dekatherm', 'mmbtus'] },
  kcal: { dim: 'energy', base: 0.0041868, system: 'any', aliases: ['calorie', 'calories', 'cal'] },

  mi: { dim: 'length', base: 1609344, system: 'imperial', aliases: ['mile', 'miles'] },
  km: { dim: 'length', base: 1000000, system: 'metric', aliases: ['kilometre', 'kilometer', 'kilometres', 'kilometers'] },
};

const LOOKUP: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [code, def] of Object.entries(UNITS)) {
    m.set(code, code);
    for (const a of def.aliases) m.set(a, code);
  }
  return m;
})();

export class UnitError extends Error {}

export function normaliseUnit(raw: string): string | null {
  const k = raw.trim().toLowerCase().replace(/\.$/, '');
  return LOOKUP.get(k) ?? LOOKUP.get(k.replace(/s$/, '')) ?? null;
}

export function dimensionOf(unit: string): Dimension | null {
  const u = normaliseUnit(unit);
  return u ? UNITS[u]!.dim : null;
}

export function convert(value: number, from: string, to: string): number {
  const f = normaliseUnit(from);
  const t = normaliseUnit(to);
  if (!f || !t) throw new UnitError(`unknown unit: ${!f ? from : to}`);
  const fd = UNITS[f]!; const td = UNITS[t]!;
  if (fd.dim !== td.dim) throw new UnitError(`cannot convert ${fd.dim} to ${td.dim}`);
  return (value * fd.base) / td.base;
}

export function areCompatible(a: string, b: string): boolean {
  const d1 = dimensionOf(a); const d2 = dimensionOf(b);
  return d1 != null && d1 === d2;
}

const FRACTIONS: Record<string, number> = {
  '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

function parseNumber(s: string): number | null {
  let t = s.trim();
  for (const [g, v] of Object.entries(FRACTIONS)) {
    if (t.includes(g)) t = t.replace(g, (t.replace(g, '').trim() ? ' ' : '') + String(v));
  }
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const mixedDec = t.match(/^(\d+)\s+([\d.]+)$/);
  if (mixedDec) return Number(mixedDec[1]) + Number(mixedDec[2]);
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

export interface Quantity { value: number; unit: string }

/** "2.5 kg" / "1 1/2 cups" / "3" / "750ml" -> {value, unit}. */
export function parseQuantity(input: string, defaultUnit = 'ea'): Quantity {
  const s = input.trim();
  if (!s) throw new UnitError('empty quantity');
  // The number part is non-greedy so a unit containing a digit (m3, ft3, R22)
  // is not swallowed by it.
  const m = s.match(/^([\d.,/\s½¼¾⅓⅔⅛⅜⅝⅞]+?)\s*([a-zA-Z"'#³²][\w³²"'#.\s]*)?\.?$/);
  if (!m) throw new UnitError(`cannot parse quantity: ${input}`);
  const value = parseNumber(m[1]!);
  if (value == null) throw new UnitError(`cannot parse number in: ${input}`);
  const rawUnit = (m[2] ?? '').trim().replace(/\.$/, '');
  const unit = rawUnit ? normaliseUnit(rawUnit) : defaultUnit;
  if (!unit) throw new UnitError(`unknown unit: ${rawUnit}`);
  return { value, unit };
}

/** "16x25x1 in" -> dimensions in a single unit. Used for filters and rooms. */
export function parseDimensions(input: string): { values: number[]; unit: string } {
  const m = input.trim().match(/^([\d.\s]+(?:[x×][\d.\s]+)+)\s*([a-zA-Z"']*)$/i);
  if (!m) throw new UnitError(`cannot parse dimensions: ${input}`);
  const values = m[1]!.split(/[x×]/).map((p) => Number(p.trim()));
  if (values.some((v) => !Number.isFinite(v))) throw new UnitError(`bad dimension in: ${input}`);
  const unit = normaliseUnit(m[2] || 'in');
  if (!unit) throw new UnitError(`unknown unit: ${m[2]}`);
  return { values, unit };
}

export function formatQuantity(q: Quantity, opts: { maxDecimals?: number } = {}): string {
  const d = opts.maxDecimals ?? 2;
  const v = Number(q.value.toFixed(d)).toString();
  const u = normaliseUnit(q.unit) ?? q.unit;
  return UNITS[u]?.dim === 'count' && u === 'ea' ? v : `${v} ${u}`;
}

/** Preferred display unit for a dimension in a given system, for auto-scaling. */
export function displayUnit(dim: Dimension, system: 'metric' | 'imperial'): string {
  const table: Record<Dimension, { metric: string; imperial: string }> = {
    mass: { metric: 'g', imperial: 'oz' },
    volume: { metric: 'ml', imperial: 'floz' },
    length: { metric: 'cm', imperial: 'in' },
    count: { metric: 'ea', imperial: 'ea' },
    temperature: { metric: 'C', imperial: 'F' },
    time: { metric: 'min', imperial: 'min' },
    energy: { metric: 'kwh', imperial: 'kwh' },
  };
  return table[dim][system];
}

export function celsiusToFahrenheit(c: number): number { return c * 9 / 5 + 32; }
export function fahrenheitToCelsius(f: number): number { return (f - 32) * 5 / 9; }

export const ALL_UNITS = Object.entries(UNITS).map(([code, d]) => ({ code, dim: d.dim, system: d.system }));
