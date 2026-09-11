# 4. Carbon as a second unit of account

Date: 2026-09-11
Status: Accepted

## Context

Greenhouse gas tracking arrived after the rest of the app was working, and the obvious
shape for it was a module: a Carbon screen that reads the other modules and reports on
them. That shape has a known ending. The report is accurate the week it is written, drifts
as the modules change underneath it, and is opened twice a year by someone who already
feels bad.

The deeper problem is that it gets the ontology wrong. A utility bill is not a financial
event that also has a carbon consequence. It is one household event measured two ways:
money out, and gas burned. So is a grocery trip, a tile order, a bag of cat food, a
binned carton of milk. Treating one measure as primary and the other as a derived report
guarantees they disagree, because only one of them is maintained.

## Decision

Carbon is a second unit of account, with the same standing as money.

- **Integer grams CO₂e** everywhere — database, API, client — for the same reason money is
  integer minor units. Formatting happens only at display, and never shows more precision
  than a household estimate has earned: one decimal place on tonnes, no more.
- **One shared attribution ledger.** `split_attribution` became `attribution`, keyed by
  `(source_kind, source_id)` where source_kind is `split` or `activity`. Both measures
  attribute to the same entities through the same table, so "what has this furnace cost
  me" and "what has this furnace emitted" are the same query with a different column.
  This replaced a working table, deliberately: two parallel ledgers would have drifted.
- **One recording path.** `recordActivity` is the exact counterpart of `attachCost`. No
  module computes emissions itself; a module that records a cost and a quantity gets both
  measures from one call, entered once.
- **Emissions snapshot their factor.** Each emission row stores the factor identity *and*
  the factor value used. Correcting a factor never silently rewrites history. Recalculation
  is a separate, previewable, audited action.
- **The household's own numbers beat published averages.** Payback is computed from the
  fuel this house actually burned and the electricity price its own bills imply. Where
  nothing was measured, the estimate says so in the row rather than looking equally
  confident.

## Consequences

**Good.** There is no reconciliation problem, because there is nothing to reconcile: the
same event produced both numbers at the same moment. Carbon appears where decisions are
made — beside the cost on an asset, a project, a pet, a binned carton — rather than in a
report. A heat pump can be argued for in dollars per tonne against this house's own oil
consumption, and the answer changes when the house does.

**Bad.** A shared polymorphic ledger is less self-describing than two typed tables; a
reader has to know that `source_kind` discriminates. Attribution is still manual, and
inherits every weakness of ADR 3. And the shipped factors are approximations from public
datasets: the app is precise about arithmetic it cannot be accurate about, which is a
trap worth naming. Every factor therefore carries its source and a confidence, every
number is traceable to the activity and factor behind it, and correcting a factor for
your own grid is a first-class action rather than a code change.
