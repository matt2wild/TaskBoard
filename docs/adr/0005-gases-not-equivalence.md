# 5. Store gases, derive equivalence

Date: 2026-09-11
Status: Accepted

## Context

ADR 4 made carbon a second unit of account, counted in integer grams of CO₂e.
That was right about the standing of carbon and wrong about the quantity.

CO₂e is not a measurement. It is a measurement multiplied by a policy choice — the
horizon over which you compare gases — and the choice is almost never stated. Methane is
about thirty times as warming as carbon dioxide over a hundred years and about eighty
times over twenty, because it absorbs strongly and leaves the atmosphere quickly. The
hundred-year figure is the convention in national inventories, and it is the one every
carbon calculator silently assumes.

For a household that convention is actively misleading. The two decisions where a house
has the most leverage — what happens to food waste, and whether it burns gas — are exactly
the two that are dominated by methane. Landfilled food waste is 2.9 times worse over twenty
years than over a hundred. Upstream leakage from natural gas is 2.2 times worse. A system
that collapsed both into GWP100 at the point of recording would have quietly told its user
that the compost heap barely matters.

Worse, the collapse is irreversible. Once an emission is stored as 450 g of CO₂e, the
methane is gone from the record and no later report can recover it.

## Decision

Store the mass of each gas. Derive equivalence at the point of reading.

- A **gas registry** holds AR6 potentials at both horizons, with the assessment they came
  from, the atmospheric lifetime, and whether the carbon is biogenic. It covers CO₂, fossil
  and biogenic methane, N₂O and the refrigerants a house actually meets.
- An **emission factor** may carry a vector of gases — kilograms of each per activity unit —
  instead of a single coefficient. Where the published source gives only a CO₂e figure, it
  is recorded against the pseudo-gas `co2e` and labelled an unspecified mixture. We do not
  invent compositions.
- An **emission** is one row per gas, storing the gas mass, the potential applied, and the
  horizon it came from, alongside the derived CO₂e so every existing query still works.
- **Reading at another horizon recomputes from the masses and writes nothing.** It is a
  different view of the same record, which is the entire point of not collapsing early.
- Masses are **integer milligrams**. Grams were not enough: two thirds of a gram of nitrous
  oxide is 184 g CO₂e, and rounding it up to a whole gram reports 273.

## Consequences

**Good.** The twenty-year view is one control, and it changes the household's conclusions
rather than decorating them. Refrigerants became simpler, not harder: a leak is a kilogram
of R-410A, and its potential belongs to the registry, so the twenty-year figure works
without a second factor. Correcting a factor scales its composition rather than being
silently ignored. And the `co2e` pseudo-gas makes the limits of the data visible — the
footprint page says what proportion of a total could be re-evaluated at all.

**Bad.** Row count roughly triples, which is nothing at household scale and would matter
at another. Reports must state their horizon, which is a small ongoing tax on every figure
that displays one. Most published food and material factors have no gas split, so the
feature is dark over a large part of a typical footprint — honest, but underwhelming until
better data exists. And the AR5-to-AR6 update moved refrigerant numbers noticeably; that is
correct, and it means figures quoted elsewhere will not match.
