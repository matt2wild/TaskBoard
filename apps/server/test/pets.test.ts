import { describe, it, expect, afterEach } from 'vitest';
import { makeHarness, makeHome, shift, today, type Harness } from './helpers.js';

let h: Harness;
afterEach(async () => { await h?.close(); });

/** C.3 from the requirements: Pepper's hyperthyroidism, start to finish. */
describe('C.3 cat medication', () => {
  async function setup() {
    h = await makeHarness();
    const home = await makeHome(h);
    const vet = await h.api('POST', '/api/v1/contacts', { name: 'Northfield Animal Hospital', type: 'vet' });
    const pet = await h.api('POST', '/api/v1/pets', {
      name: 'Pepper', speciesCode: 'cat', dob: '2014-04-02',
      primaryVetContactId: vet.id, weightUnit: 'lb', targetWeightMin: 9, targetWeightMax: 11,
    });
    return { home, vet, pet };
  }

  it('turns a vet visit into a diagnosis, a cost, a prescription and dose tasks', async () => {
    const { home, vet, pet } = await setup();
    const med = await h.api('POST', '/api/v1/products', {
      name: 'Methimazole 2.5mg', isFood: false, isPetSupply: true, defaultUnit: 'dose',
    });
    await h.api('POST', '/api/v1/stock', { productId: med.id, quantity: 100, unit: 'dose', locationId: home.roomId });

    const visit = await h.api('POST', `/api/v1/pets/${pet.id}/visits`, {
      visitedAt: today(), providerContactId: vet.id,
      reason: 'Weight loss and increased appetite', diagnosis: 'Hyperthyroidism',
      weight: 9.4, followUpDate: shift(28),
      cost: { amount: 21500, payeeName: 'Northfield Animal Hospital' },
      createCondition: 'Hyperthyroidism',
      prescriptions: [{ name: 'Methimazole', dose: '1 tablet', timesOfDay: ['08:00', '20:00'], everyDays: 1 }],
    });
    expect(visit.transactionId).toBeTruthy();
    expect(visit.conditionId).toBeTruthy();
    expect(visit.followUpTaskId).toBeTruthy();
    expect(visit.medications).toHaveLength(1);

    // Two doses a day become two checkable tasks a day.
    const doses = await h.api('GET', `/api/v1/pet-doses?petId=${pet.id}&from=${today()}&to=${today()}`);
    expect(doses.items).toHaveLength(2);
    expect(doses.items.map((d: any) => d.dueTime)).toEqual(['08:00', '20:00']);

    // The visit weight joined the weight series.
    const weights = await h.api('GET', `/api/v1/pets/${pet.id}/weights`);
    expect(weights.latest).toBe(9.4);

    // And the money is attributed to the cat, not just to a category.
    const overview = await h.api('GET', `/api/v1/pets/${pet.id}/overview`);
    expect(overview.spend.total).toBe(21500);
    expect(overview.conditions[0].name).toBe('Hyperthyroidism');
  });

  it('checking off a dose task marks the dose given and takes one off the shelf', async () => {
    const { home, pet } = await setup();
    const product = await h.api('POST', '/api/v1/products', {
      name: 'Methimazole', isFood: false, defaultUnit: 'dose',
    });
    await h.api('POST', '/api/v1/stock', { productId: product.id, quantity: 10, unit: 'dose', locationId: home.roomId });
    await h.api('POST', '/api/v1/pet-medications', {
      petId: pet.id, name: 'Methimazole', dose: '1 tablet',
      timesOfDay: ['08:00', '20:00'], startDate: today(), productId: product.id, dosesPerUnit: 1,
    });

    const doses = await h.api('GET', `/api/v1/pet-doses?petId=${pet.id}`);
    const first = doses.items[0];
    expect(first.taskId).toBeTruthy();

    await h.api('POST', `/api/v1/tasks/${first.taskId}/complete`, {});

    const after = await h.api('GET', `/api/v1/pet-doses?petId=${pet.id}`);
    const same = after.items.find((d: any) => d.id === first.id);
    expect(same.status).toBe('given');
    expect(same.givenBy).toBe(h.userId);

    const stock = await h.api('GET', `/api/v1/products/${product.id}`);
    expect(stock.onHand).toBe(9);
  });

  it('does not double-book doses when the generator runs again', async () => {
    const { pet } = await setup();
    await h.api('POST', '/api/v1/pet-medications', {
      petId: pet.id, name: 'Methimazole', timesOfDay: ['08:00', '20:00'], startDate: today(),
    });
    const before = await h.api('GET', `/api/v1/pet-doses?petId=${pet.id}`);
    const again = await h.api('POST', '/api/v1/pet-doses/materialise', { horizonDays: 3 });
    expect(again.created).toBe(0);
    const after = await h.api('GET', `/api/v1/pet-doses?petId=${pet.id}`);
    expect(after.items.length).toBe(before.items.length);
  });

  it('spaces a monthly preventive on its cycle, not every day', async () => {
    const { pet } = await setup();
    await h.api('POST', '/api/v1/pet-medications', {
      petId: pet.id, name: 'Revolution Plus', kind: 'preventive',
      timesOfDay: ['19:00'], everyDays: 30, startDate: today(),
    });
    const doses = await h.api('GET', `/api/v1/pet-doses?petId=${pet.id}`);
    expect(doses.items).toHaveLength(1);
    expect(doses.items[0].dueDate).toBe(today());
  });

  it('projects when the medication runs out', async () => {
    const { home, pet } = await setup();
    const product = await h.api('POST', '/api/v1/products', {
      name: 'Methimazole', isFood: false, defaultUnit: 'dose',
    });
    await h.api('POST', '/api/v1/stock', { productId: product.id, quantity: 20, unit: 'dose', locationId: home.roomId });
    await h.api('POST', '/api/v1/pet-medications', {
      petId: pet.id, name: 'Methimazole', timesOfDay: ['08:00', '20:00'],
      startDate: today(), productId: product.id, dosesPerUnit: 1,
    });
    const runOut = await h.api('GET', `/api/v1/pets/${pet.id}/run-out`);
    const med = runOut.items.find((i: any) => i.kind === 'medication');
    expect(med.perDay).toBe(2);
    expect(med.daysLeft).toBe(10);
    expect(med.runsOut).toBe(shift(10));
  });

  it('warns on a rapid weight change', async () => {
    const { pet } = await setup();
    await h.api('POST', `/api/v1/pets/${pet.id}/weights`, { weight: 11.0, takenAt: shift(-40) });
    const res = await h.api('POST', `/api/v1/pets/${pet.id}/weights`, { weight: 9.4 });
    expect(res.trend.changePct).toBeLessThan(-10);
    expect(res.trend.warn).toBe(true);
  });

  it('builds a care sheet a sitter could actually follow', async () => {
    const { home, vet, pet } = await setup();
    const food = await h.api('POST', '/api/v1/products', {
      name: 'Wet cat food', isPetSupply: true, defaultUnit: 'can', minQuantity: 12,
    });
    await h.api('POST', '/api/v1/stock', { productId: food.id, quantity: 20, locationId: home.pantryId });
    await h.api('PUT', `/api/v1/pets/${pet.id}/diet`, {
      entries: [
        { timeOfDay: '07:30', productId: food.id, amount: 1, unit: 'can' },
        { timeOfDay: '19:30', productId: food.id, amount: 1, unit: 'can' },
      ],
    });
    await h.api('POST', '/api/v1/pet-medications', {
      petId: pet.id, name: 'Methimazole', dose: '1 tablet',
      timesOfDay: ['08:00', '20:00'], startDate: today(),
      instructionsMd: 'Give with food.',
    });
    await h.api('POST', `/api/v1/pets/${pet.id}/vaccinations`, {
      vaccine: 'Rabies', givenAt: shift(-300),
    });

    const sheet = await h.api('GET', `/api/v1/pets/${pet.id}/care-sheet`);
    expect(sheet.feeding).toHaveLength(2);
    expect(sheet.feeding[0].what).toBe('Wet cat food');
    expect(sheet.medications[0].timesOfDay).toEqual(['08:00', '20:00']);
    expect(sheet.vet.name).toBe('Northfield Animal Hospital');
    // The rabies preset gave the booster a due date without anyone typing one.
    expect(sheet.vaccinations[0].nextDue).toBe(shift(-300 + 365 * 3 + 1));
  });

  it('projects pet food run-out from the feeding schedule', async () => {
    const { home, pet } = await setup();
    const food = await h.api('POST', '/api/v1/products', {
      name: 'Wet cat food', isPetSupply: true, defaultUnit: 'can',
    });
    await h.api('POST', '/api/v1/stock', { productId: food.id, quantity: 8, locationId: home.pantryId });
    await h.api('PUT', `/api/v1/pets/${pet.id}/diet`, {
      entries: [
        { timeOfDay: '07:30', productId: food.id, amount: 1, unit: 'can' },
        { timeOfDay: '19:30', productId: food.id, amount: 1, unit: 'can' },
      ],
    });
    const runOut = await h.api('GET', `/api/v1/pets/${pet.id}/run-out`);
    const chow = runOut.items.find((i: any) => i.kind === 'food');
    expect(chow.perDay).toBe(2);
    expect(chow.daysLeft).toBe(4);
  });

  it('stops reminding about a cat that has died, but keeps the history', async () => {
    const { pet } = await setup();
    await h.api('POST', '/api/v1/pet-medications', {
      petId: pet.id, name: 'Methimazole', timesOfDay: ['08:00'], startDate: today(),
    });
    const before = await h.api('GET', `/api/v1/pet-doses?petId=${pet.id}`);
    expect(before.items.length).toBeGreaterThan(0);

    await h.api('POST', `/api/v1/pets/${pet.id}/status`, { status: 'deceased' });

    const after = await h.api('GET', `/api/v1/pet-doses?petId=${pet.id}&status=due`);
    const futureDue = after.items.filter((d: any) => d.dueDate >= today());
    expect(futureDue).toHaveLength(0);

    const still = await h.api('GET', `/api/v1/pets/${pet.id}`);
    expect(still.status).toBe('deceased');
    const overview = await h.api('GET', `/api/v1/pets/${pet.id}/overview`);
    expect(overview.pet.name).toBe('Pepper');
  });
});
