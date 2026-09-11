/**
 * Shipped emission factors (GHG-002).
 *
 * Every one of these is an **approximate default meant to be corrected**. Grid
 * intensity varies by more than a factor of ten between regions; food and
 * material figures are global medians with wide error bars. They are here so
 * the application is useful on the first day, not because they are authoritative
 * for any particular household — which is why each carries a source, a
 * confidence, and an editable row in the database.
 */

export interface FactorSeed {
  key: string;
  name: string;
  category: string;
  activityUnit: string;
  kgPerUnit: number;
  scope: 1 | 2 | 3;
  region?: string;
  source: string;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
  /**
   * Kilograms of each gas per activity unit, given only where the source
   * genuinely publishes a composition (GHG-032). Most food and material
   * figures are single CO₂e numbers and are left without one, which records
   * them honestly as an unspecified mixture rather than inventing a split.
   */
  gases?: Record<string, number>;
}

const EPA = 'US EPA GHG Emission Factors Hub (approximate; verify for your region)';
const PN = 'Poore & Nemecek (2018), Science — global medians, cradle to retail';
const ICE = 'Inventory of Carbon and Energy, University of Bath (approximate)';
const AR6 = 'IPCC AR6 GWP, applied to the gas itself';
const EPA_GAS = 'US EPA GHG Emission Factors Hub, per-gas combustion factors';
const PN_GAS = 'Poore & Nemecek (2018) supplementary data — enteric split approximate';
const DEFRA = 'UK DEFRA conversion factors (approximate)';

export const FACTOR_SEEDS: FactorSeed[] = [
  /* ── electricity ── */
  { key: 'electricity.grid', name: 'Grid electricity', category: 'energy', activityUnit: 'kwh',
    kgPerUnit: 0.371, scope: 2, region: 'US', source: EPA, confidence: 'medium',
    gases: { co2: 0.3689, ch4_fossil: 0.000030, n2o: 0.0000050 },
    notes: 'US national average. Regional grids range from under 0.05 to over 0.8 kg/kWh — correct this for where you live and the number becomes meaningful.' },
  { key: 'electricity.grid', name: 'Grid electricity (global default)', category: 'energy', activityUnit: 'kwh',
    kgPerUnit: 0.475, scope: 2, source: 'IEA global average (approximate)', confidence: 'low',
    notes: 'Fallback when no regional factor is set.' },
  { key: 'electricity.upstream', name: 'Electricity transmission losses', category: 'energy', activityUnit: 'kwh',
    kgPerUnit: 0.032, scope: 3, region: 'US', source: EPA, confidence: 'low',
    notes: 'Losses between the power station and the meter, which you pay for in carbon but not on the bill.' },

  /* ── fuels burned here ── */
  { key: 'gas.combustion', name: 'Natural gas, burned', category: 'energy', activityUnit: 'therm',
    kgPerUnit: 5.31, scope: 1, source: EPA_GAS, confidence: 'high',
    gases: { co2: 5.306, ch4_fossil: 0.0001, n2o: 0.00001 },
    notes: 'Burning gas cleanly is almost all carbon dioxide. It is the gas that never reached the burner, upstream, that carries the methane.' },
  { key: 'gas.upstream', name: 'Natural gas, extraction and delivery', category: 'energy', activityUnit: 'therm',
    kgPerUnit: 1.02, scope: 3, source: EPA_GAS, confidence: 'low',
    gases: { co2: 0.35, ch4_fossil: 0.0225 },
    notes: 'Almost entirely methane that leaked before the meter, so this is the factor most sensitive to the horizon: it roughly doubles over twenty years. Leakage estimates vary widely — this is a middling one.' },
  { key: 'oil.combustion', name: 'Heating oil, burned', category: 'energy', activityUnit: 'gal',
    kgPerUnit: 10.24, scope: 1, source: EPA_GAS, confidence: 'high',
    gases: { co2: 10.21, ch4_fossil: 0.00042, n2o: 0.000083 },
    notes: 'No. 2 distillate.' },
  { key: 'oil.upstream', name: 'Heating oil, refining and delivery', category: 'energy', activityUnit: 'gal',
    kgPerUnit: 1.80, scope: 3, source: EPA_GAS, confidence: 'low',
    gases: { co2: 1.65, ch4_fossil: 0.005 } },
  { key: 'propane.combustion', name: 'Propane, burned', category: 'energy', activityUnit: 'gal',
    kgPerUnit: 5.74, scope: 1, source: EPA_GAS, confidence: 'high',
    gases: { co2: 5.72, ch4_fossil: 0.00027, n2o: 0.000055 } },
  { key: 'propane.upstream', name: 'Propane, upstream', category: 'energy', activityUnit: 'gal',
    kgPerUnit: 0.80, scope: 3, source: EPA, confidence: 'low' },
  { key: 'wood.combustion', name: 'Firewood', category: 'energy', activityUnit: 'kg',
    kgPerUnit: 0.04, scope: 1, source: DEFRA, confidence: 'low',
    gases: { ch4_bio: 0.001, n2o: 0.00005 },
    notes: 'Only the non-CO₂ products of combustion. The carbon dioxide is biogenic — the tree took it out of the air on the way up — and counting it again on the way down would be double counting, on the assumption the wood is sustainably harvested. That assumption is worth checking (GHG-037).' },
  { key: 'district_heat.supply', name: 'District heat', category: 'energy', activityUnit: 'kwh',
    kgPerUnit: 0.17, scope: 2, source: DEFRA, confidence: 'low' },

  /* ── transport ── */
  { key: 'gasoline.combustion', name: 'Petrol, burned', category: 'transport', activityUnit: 'gal',
    kgPerUnit: 8.81, scope: 1, source: EPA_GAS, confidence: 'high',
    gases: { co2: 8.78, ch4_fossil: 0.0003, n2o: 0.00008 },
    notes: 'The non-CO₂ share depends heavily on the age and after-treatment of the engine; these are modern passenger-car figures.' },
  { key: 'gasoline.upstream', name: 'Petrol, refining and delivery', category: 'transport', activityUnit: 'gal',
    kgPerUnit: 2.32, scope: 3, source: EPA, confidence: 'low' },
  { key: 'diesel.combustion', name: 'Diesel, burned', category: 'transport', activityUnit: 'gal',
    kgPerUnit: 10.29, scope: 1, source: EPA_GAS, confidence: 'high',
    gases: { co2: 10.21, ch4_fossil: 0.0003, n2o: 0.00025 } },
  { key: 'vehicle.car_petrol', name: 'Car, petrol', category: 'transport', activityUnit: 'mi',
    kgPerUnit: 0.404, scope: 1, source: EPA, confidence: 'medium',
    notes: 'Average US passenger vehicle. A specific car is better tracked by fuel bought.' },
  { key: 'vehicle.car_ev', name: 'Car, electric', category: 'transport', activityUnit: 'mi',
    kgPerUnit: 0.13, scope: 2, region: 'US', source: EPA, confidence: 'low',
    notes: 'Entirely dependent on grid intensity; recalculate if you correct the grid factor.' },
  { key: 'vehicle.van', name: 'Van or pickup', category: 'transport', activityUnit: 'mi',
    kgPerUnit: 0.55, scope: 1, source: EPA, confidence: 'low' },

  /* ── water and waste ── */
  { key: 'water.supply', name: 'Mains water and treatment', category: 'water', activityUnit: 'm3',
    kgPerUnit: 0.35, scope: 3, source: DEFRA, confidence: 'low',
    gases: { co2: 0.34, ch4_fossil: 0.0002 } },
  { key: 'waste.landfill', name: 'Waste to landfill', category: 'waste', activityUnit: 'kg',
    kgPerUnit: 0.45, scope: 3, source: DEFRA, confidence: 'low',
    gases: { co2: 0.03, ch4_bio: 0.0155 },
    notes: 'Mixed household waste. Almost all of it is methane from organics decomposing without oxygen, which is why it nearly triples over a twenty-year horizon.' },
  { key: 'waste.food_landfill', name: 'Food waste to landfill', category: 'waste', activityUnit: 'kg',
    kgPerUnit: 0.60, scope: 3, source: DEFRA, confidence: 'low',
    gases: { co2: 0.03, ch4_bio: 0.021 },
    notes: 'Food rots faster and wetter than mixed waste, so it makes more methane. This is the counterfactual the compost module is measured against.' },
  { key: 'waste.recycled', name: 'Waste recycled', category: 'waste', activityUnit: 'kg',
    kgPerUnit: 0.021, scope: 3, source: DEFRA, confidence: 'low' },
  { key: 'waste.compost', name: 'Waste composted', category: 'waste', activityUnit: 'kg',
    kgPerUnit: 0.010, scope: 3, source: DEFRA, confidence: 'low',
    gases: { co2: 0.004, ch4_bio: 0.00015, n2o: 0.0000075 },
    notes: 'A working aerobic pile is not emission-free: it makes a little methane in its anaerobic pockets and a little nitrous oxide from the nitrogen. It is about a sixtieth of landfill, not zero, and the module says so (COMP-012).' },
  { key: 'waste.compost_anaerobic', name: 'Compost, poorly managed', category: 'waste', activityUnit: 'kg',
    kgPerUnit: 0.12, scope: 3, source: DEFRA, confidence: 'low',
    gases: { co2: 0.004, ch4_bio: 0.0035, n2o: 0.00008 },
    notes: 'A wet, compacted, unturned pile goes anaerobic and makes real methane. Roughly twelve times a managed pile, and worth knowing before claiming the benefit.' },
  { key: 'waste.reuse', name: 'Given away or sold on', category: 'waste', activityUnit: 'kg',
    kgPerUnit: 0, scope: 3, source: 'By convention', confidence: 'low',
    notes: 'Counted as zero here. The emissions were already counted when the thing was bought.' },

  /* ── refrigerants: tiny masses, enormous effect ──
     These are the cleanest case for storing gases rather than equivalence. A
     kilogram that leaked out of a heat pump is a kilogram of that refrigerant,
     and the potential belongs to the gas registry — so the twenty-year view
     works on them without a second factor. R-410A is more than twice as strong
     over twenty years as its hundred-year figure suggests. */
  { key: 'refrigerant.r410a', name: 'R-410A', category: 'refrigerant', activityUnit: 'kg',
    kgPerUnit: 2256, scope: 1, source: AR6, confidence: 'high', gases: { r410a: 1 } },
  { key: 'refrigerant.r32', name: 'R-32', category: 'refrigerant', activityUnit: 'kg',
    kgPerUnit: 771, scope: 1, source: AR6, confidence: 'high', gases: { r32: 1 } },
  { key: 'refrigerant.r134a', name: 'R-134a', category: 'refrigerant', activityUnit: 'kg',
    kgPerUnit: 1530, scope: 1, source: AR6, confidence: 'high', gases: { r134a: 1 } },
  { key: 'refrigerant.r22', name: 'R-22', category: 'refrigerant', activityUnit: 'kg',
    kgPerUnit: 1960, scope: 1, source: AR6, confidence: 'high', gases: { r22: 1 } },
  { key: 'refrigerant.r404a', name: 'R-404A', category: 'refrigerant', activityUnit: 'kg',
    kgPerUnit: 4728, scope: 1, source: AR6, confidence: 'high', gases: { r404a: 1 } },
  { key: 'refrigerant.r454b', name: 'R-454B', category: 'refrigerant', activityUnit: 'kg',
    kgPerUnit: 531, scope: 1, source: AR6, confidence: 'medium',
    gases: { r32: 0.689, r1234yf: 0.311 },
    notes: 'A blend, so it is recorded as its components and the potentials come from them. Widely quoted as 466 on AR4 values; this is the same blend under AR6, which is higher.' },
  { key: 'refrigerant.r290', name: 'R-290 (propane)', category: 'refrigerant', activityUnit: 'kg',
    kgPerUnit: 3, scope: 1, source: AR6, confidence: 'high', gases: { r290: 1 } },
  { key: 'refrigerant.r600a', name: 'R-600a (isobutane)', category: 'refrigerant', activityUnit: 'kg',
    kgPerUnit: 3, scope: 1, source: AR6, confidence: 'high', gases: { r600a: 1 },
    notes: 'In most modern domestic fridges, and near enough harmless if it leaks.' },

  /* ── food, per kilogram ── */
  { key: 'food.beef', name: 'Beef', category: 'food', activityUnit: 'kg', kgPerUnit: 60, scope: 3, source: PN_GAS, confidence: 'medium',
    gases: { co2: 29.9, ch4_bio: 0.78, n2o: 0.033 },
    notes: 'Roughly a third of beef\u2019s footprint is enteric methane from the animal itself, which is why it looks worse still over twenty years. The split is approximate; the total is the better-established number.' },
  { key: 'food.lamb', name: 'Lamb', category: 'food', activityUnit: 'kg', kgPerUnit: 39.7, scope: 3, source: PN_GAS, confidence: 'medium',
    gases: { co2: 19.6, ch4_bio: 0.55, n2o: 0.019 } },
  { key: 'food.cheese', name: 'Cheese', category: 'food', activityUnit: 'kg', kgPerUnit: 23.9, scope: 3, source: PN_GAS, confidence: 'medium',
    gases: { co2: 11.8, ch4_bio: 0.32, n2o: 0.012 } },
  { key: 'food.pork', name: 'Pork', category: 'food', activityUnit: 'kg', kgPerUnit: 12.3, scope: 3, source: PN, confidence: 'medium' },
  { key: 'food.poultry', name: 'Poultry', category: 'food', activityUnit: 'kg', kgPerUnit: 9.9, scope: 3, source: PN, confidence: 'medium' },
  { key: 'food.fish', name: 'Fish and seafood', category: 'food', activityUnit: 'kg', kgPerUnit: 11.9, scope: 3, source: PN, confidence: 'low' },
  { key: 'food.eggs', name: 'Eggs', category: 'food', activityUnit: 'kg', kgPerUnit: 4.7, scope: 3, source: PN, confidence: 'medium' },
  { key: 'food.milk', name: 'Milk and dairy', category: 'food', activityUnit: 'kg', kgPerUnit: 3.2, scope: 3, source: PN_GAS, confidence: 'medium',
    gases: { co2: 1.57, ch4_bio: 0.044, n2o: 0.0016 } },
  { key: 'food.rice', name: 'Rice', category: 'food', activityUnit: 'kg', kgPerUnit: 4.5, scope: 3, source: PN_GAS, confidence: 'medium',
    gases: { co2: 1.9, ch4_bio: 0.088, n2o: 0.0008 },
    notes: 'Flooded paddies are anaerobic, so rice is the one staple crop with a large methane share.' },
  { key: 'food.grains', name: 'Grains, bread and pasta', category: 'food', activityUnit: 'kg', kgPerUnit: 1.6, scope: 3, source: PN, confidence: 'medium' },
  { key: 'food.legumes', name: 'Beans and pulses', category: 'food', activityUnit: 'kg', kgPerUnit: 1.0, scope: 3, source: PN, confidence: 'medium' },
  { key: 'food.tofu', name: 'Tofu and soy', category: 'food', activityUnit: 'kg', kgPerUnit: 3.2, scope: 3, source: PN, confidence: 'medium' },
  { key: 'food.vegetables', name: 'Vegetables', category: 'food', activityUnit: 'kg', kgPerUnit: 0.5, scope: 3, source: PN, confidence: 'medium' },
  { key: 'food.potatoes', name: 'Potatoes and roots', category: 'food', activityUnit: 'kg', kgPerUnit: 0.5, scope: 3, source: PN, confidence: 'medium' },
  { key: 'food.fruit', name: 'Fruit', category: 'food', activityUnit: 'kg', kgPerUnit: 0.9, scope: 3, source: PN, confidence: 'medium' },
  { key: 'food.nuts', name: 'Nuts and seeds', category: 'food', activityUnit: 'kg', kgPerUnit: 0.4, scope: 3, source: PN, confidence: 'medium' },
  { key: 'food.oils', name: 'Cooking oils', category: 'food', activityUnit: 'kg', kgPerUnit: 5.4, scope: 3, source: PN, confidence: 'low' },
  { key: 'food.coffee', name: 'Coffee', category: 'food', activityUnit: 'kg', kgPerUnit: 28.5, scope: 3, source: PN, confidence: 'low' },
  { key: 'food.chocolate', name: 'Chocolate', category: 'food', activityUnit: 'kg', kgPerUnit: 46.7, scope: 3, source: PN, confidence: 'low' },
  { key: 'food.sugar', name: 'Sugar and sweets', category: 'food', activityUnit: 'kg', kgPerUnit: 3.2, scope: 3, source: PN, confidence: 'low' },
  { key: 'food.beverages', name: 'Soft drinks and juice', category: 'food', activityUnit: 'kg', kgPerUnit: 0.9, scope: 3, source: PN, confidence: 'low' },
  { key: 'food.general', name: 'Groceries, unclassified', category: 'food', activityUnit: 'kg', kgPerUnit: 2.5, scope: 3, source: PN, confidence: 'low',
    notes: 'A blunt average for anything not categorised. Categorise the product and this stops being a guess.' },

  /* ── pet food ── */
  { key: 'petfood.dry', name: 'Dry pet food', category: 'food', activityUnit: 'kg', kgPerUnit: 3.5, scope: 3, source: 'Published pet-food LCA ranges (approximate)', confidence: 'low' },
  { key: 'petfood.wet', name: 'Wet pet food', category: 'food', activityUnit: 'kg', kgPerUnit: 1.6, scope: 3, source: 'Published pet-food LCA ranges (approximate)', confidence: 'low',
    notes: 'Lower per kilogram than dry food mostly because it is largely water.' },

  /* ── renovation materials, per kilogram ── */
  { key: 'material.concrete', name: 'Concrete', category: 'material', activityUnit: 'kg', kgPerUnit: 0.13, scope: 3, source: ICE, confidence: 'medium' },
  { key: 'material.cement', name: 'Cement', category: 'material', activityUnit: 'kg', kgPerUnit: 0.91, scope: 3, source: ICE, confidence: 'medium' },
  { key: 'material.steel', name: 'Steel', category: 'material', activityUnit: 'kg', kgPerUnit: 1.55, scope: 3, source: ICE, confidence: 'medium' },
  { key: 'material.lumber', name: 'Softwood lumber', category: 'material', activityUnit: 'kg', kgPerUnit: 0.45, scope: 3, source: ICE, confidence: 'low',
    notes: 'Excludes the carbon stored in the wood itself, which some methods count as a credit.' },
  { key: 'material.plywood', name: 'Plywood and sheet goods', category: 'material', activityUnit: 'kg', kgPerUnit: 0.68, scope: 3, source: ICE, confidence: 'low' },
  { key: 'material.drywall', name: 'Plasterboard', category: 'material', activityUnit: 'kg', kgPerUnit: 0.39, scope: 3, source: ICE, confidence: 'medium' },
  { key: 'material.insulation_fibreglass', name: 'Fibreglass insulation', category: 'material', activityUnit: 'kg', kgPerUnit: 1.35, scope: 3, source: ICE, confidence: 'low' },
  { key: 'material.insulation_mineral', name: 'Mineral wool insulation', category: 'material', activityUnit: 'kg', kgPerUnit: 1.20, scope: 3, source: ICE, confidence: 'low' },
  { key: 'material.insulation_xps', name: 'XPS foam board', category: 'material', activityUnit: 'kg', kgPerUnit: 3.40, scope: 3, source: ICE, confidence: 'low',
    notes: 'Highly dependent on the blowing agent; older formulations are far worse.' },
  { key: 'material.tile', name: 'Ceramic or porcelain tile', category: 'material', activityUnit: 'kg', kgPerUnit: 0.78, scope: 3, source: ICE, confidence: 'low' },
  { key: 'material.paint', name: 'Paint', category: 'material', activityUnit: 'l', kgPerUnit: 3.2, scope: 3, source: ICE, confidence: 'low' },
  { key: 'material.copper', name: 'Copper pipe and wire', category: 'material', activityUnit: 'kg', kgPerUnit: 2.60, scope: 3, source: ICE, confidence: 'low' },
  { key: 'material.pvc', name: 'PVC pipe', category: 'material', activityUnit: 'kg', kgPerUnit: 3.10, scope: 3, source: ICE, confidence: 'low' },
  { key: 'material.asphalt_shingle', name: 'Asphalt shingle', category: 'material', activityUnit: 'kg', kgPerUnit: 0.50, scope: 3, source: ICE, confidence: 'low' },
  { key: 'material.glass', name: 'Glass', category: 'material', activityUnit: 'kg', kgPerUnit: 1.40, scope: 3, source: ICE, confidence: 'low' },
];

/** Maps the shipped product categories to a default food factor (GHG-010). */
export const PRODUCT_CATEGORY_FACTORS: Record<string, string> = {
  'produce': 'food.vegetables',
  'dairy-eggs': 'food.milk',
  'meat-seafood': 'food.poultry',
  'bakery': 'food.grains',
  'pantry-staples': 'food.general',
  'grains': 'food.grains',
  'pasta': 'food.grains',
  'canned-goods': 'food.legumes',
  'baking': 'food.grains',
  'oils-vinegars': 'food.oils',
  'spices': 'food.general',
  'condiments': 'food.general',
  'frozen': 'food.general',
  'beverages': 'food.beverages',
  'snacks': 'food.general',
  'pet-food-supplies': 'petfood.dry',
  'cat-food-wet': 'petfood.wet',
  'cat-food-dry': 'petfood.dry',
  'treats': 'petfood.dry',
};

export interface InterventionTemplateSeed {
  key: string;
  name: string;
  category: string;
  descriptionMd: string;
  typicalCost: number;
  embodiedGCo2e: number;
  lifetimeYears: number;
  savingModel: {
    kind: 'fuel_switch' | 'reduce' | 'generate';
    fuel?: string;
    existingEfficiency?: number;
    replacementCop?: number;
    fraction?: number;
    annualKwh?: number;
  };
}

const T = 1_000_000; // one tonne, in grams

export const INTERVENTION_TEMPLATES: InterventionTemplateSeed[] = [
  {
    key: 'smart_thermostat', name: 'Smart thermostat', category: 'heating',
    descriptionMd: 'Setback scheduling on the existing system. The cheapest thing on this list and usually the fastest payback.',
    typicalCost: 20_000, embodiedGCo2e: Math.round(0.02 * T), lifetimeYears: 10,
    savingModel: { kind: 'reduce', fuel: 'heating_oil', fraction: 0.08 },
  },
  {
    key: 'air_sealing', name: 'Air sealing', category: 'envelope',
    descriptionMd: 'Seal the leaks a blower-door test finds. Almost always worth doing before anything else.',
    typicalCost: 80_000, embodiedGCo2e: Math.round(0.1 * T), lifetimeYears: 20,
    savingModel: { kind: 'reduce', fuel: 'heating_oil', fraction: 0.10 },
  },
  {
    key: 'attic_insulation', name: 'Attic insulation top-up', category: 'envelope',
    descriptionMd: 'Bring the attic up to a modern depth. Cheap per unit of heat saved, and it works every winter for thirty years.',
    typicalCost: 250_000, embodiedGCo2e: Math.round(0.6 * T), lifetimeYears: 30,
    savingModel: { kind: 'reduce', fuel: 'heating_oil', fraction: 0.15 },
  },
  {
    key: 'heat_pump', name: 'Air-source heat pump', category: 'heating',
    descriptionMd: 'Replace fossil heating with a heat pump. The single largest lever in most houses, and it gets cleaner every year the grid does.',
    typicalCost: 1_400_000, embodiedGCo2e: Math.round(1.9 * T), lifetimeYears: 18,
    savingModel: { kind: 'fuel_switch', fuel: 'heating_oil', existingEfficiency: 0.82, replacementCop: 3.0 },
  },
  {
    key: 'heat_pump_water_heater', name: 'Heat pump water heater', category: 'water_heating',
    descriptionMd: 'Roughly a third of the electricity of a resistance tank. Needs a reasonably warm space with some air volume around it.',
    typicalCost: 320_000, embodiedGCo2e: Math.round(0.5 * T), lifetimeYears: 13,
    savingModel: { kind: 'reduce', fuel: 'electricity', fraction: 0.12 },
  },
  {
    key: 'solar_pv', name: 'Rooftop solar', category: 'generation',
    descriptionMd: 'Generate on site. The saving depends heavily on how dirty your grid is: the worse the grid, the more this does.',
    typicalCost: 1_800_000, embodiedGCo2e: Math.round(8 * T), lifetimeYears: 25,
    savingModel: { kind: 'generate', annualKwh: 6000 },
  },
  {
    key: 'induction_range', name: 'Induction range', category: 'appliance',
    descriptionMd: 'Removes gas combustion from the kitchen, which matters for indoor air quality as much as for carbon.',
    typicalCost: 250_000, embodiedGCo2e: Math.round(0.3 * T), lifetimeYears: 15,
    savingModel: { kind: 'reduce', fuel: 'natural_gas', fraction: 0.05 },
  },
  {
    key: 'led_lighting', name: 'LED throughout', category: 'appliance',
    descriptionMd: 'Whatever is left on halogen or fluorescent. Small, but the payback is measured in months.',
    typicalCost: 20_000, embodiedGCo2e: Math.round(0.02 * T), lifetimeYears: 15,
    savingModel: { kind: 'reduce', fuel: 'electricity', fraction: 0.05 },
  },
  {
    key: 'window_replacement', name: 'Replace single glazing', category: 'envelope',
    descriptionMd: 'Expensive per unit of heat saved, and rarely the best carbon buy. Listed so the comparison is honest.',
    typicalCost: 1_500_000, embodiedGCo2e: Math.round(2.5 * T), lifetimeYears: 30,
    savingModel: { kind: 'reduce', fuel: 'heating_oil', fraction: 0.10 },
  },
];
