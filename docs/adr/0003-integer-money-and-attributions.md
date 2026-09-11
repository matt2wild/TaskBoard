# 3. Integer money, and attributing it to things

Date: 2026-09-11
Status: Accepted

## Context

Two failure modes in household finance software. The first is floating-point money, where
totals drift by a cent and nobody can say why. The second is subtler: a category tells you
you spent $2,400 on "Home maintenance" last year, but not that $1,800 of it was the same
failing water heater telling you something.

## Decision

Money is always an integer count of minor units, at every layer — database, API, client.
Formatting happens only at the point of display. Allocation across splits uses a largest-
remainder method that provably re-sums to the total, and that property is tested against
pathological inputs.

Every transaction split can carry **attributions**: links to the asset, project, pet, tool
or location the money was for. A transaction can be split across several. Every module that
records a cost goes through one `attachCost` function, so a furnace filter, a tile order and
a vet bill all land in the ledger the same way.

## Consequences

**Good.** "What has this furnace cost me?" and "what did the bathroom actually come to?"
are one query each. Totals never drift. The budget module stayed small because it does not
need to know about furnaces.

**Bad.** Attribution is manual. Nothing infers that a hardware-store receipt belongs to the
bathroom project, and a household that never attributes anything gets an ordinary category
budget and none of the benefit.
