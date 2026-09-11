# 6. Avoided emissions are never netted against the footprint

Date: 2026-09-11
Status: Accepted

## Context

The garden, the compost heap and the repair log all produce a number that is enormously
tempting to subtract: the tonne of landfill methane the pile did not cause, the appliance
the repair did not have manufactured, the supermarket tomato the garden displaced.

Subtracting them is the standard move, and it is the most common dishonesty in carbon
accounting. It lets a household's reported footprint fall while its actual emissions do
not, because what is being subtracted never happened. Taken far enough it produces the
negative footprints that make corporate climate reporting a joke.

It is also the move the household most wants the software to make, which is exactly why the
decision has to be structural rather than a matter of discipline.

## Decision

Avoided emissions live in their own table and are never summed with, subtracted from, or
joined into the footprint.

- `avoided_emission` is a separate table, not a negative `emission`. No query that computes
  a footprint can reach it by accident.
- Every row carries its **counterfactual in words** — "a typical replacement dishwasher,
  not bought — 40% of its embodied carbon, for the 4 years this repair bought" — and the UI
  shows that sentence wherever it shows the number.
- Avoided figures are **pro-rated honestly**. A repair that buys four years of a ten-year
  machine avoided four tenths of a replacement, not a whole one.
- They are reported **beside** the footprint, under a heading that says they are not part of
  it, at both horizons where the composition allows it.

The corollary is that what a household *actually* emits is always recorded, even when it is
inconvenient. A compost pile is not emission-free: it makes a little methane in its
anaerobic pockets and a little nitrous oxide from the nitrogen, roughly a sixtieth of
landfill. The module books that, and an unturned cold pile gets a factor twelve times
higher, because it deserves one.

This principle also caught an existing bug. Wasting food re-recorded the food's embodied
carbon as a new emission, on top of the emission booked when it was bought — doubling the
household's footprint for the same kilogram. The embodied figure is worth showing, because
it is the number that changes behaviour, but it is a *re-description* of emissions already
counted rather than new ones. It is now reported, and only the disposal is emitted.

## Consequences

**Good.** The footprint means one thing: what this household caused. The circularity report
means another: what it avoided causing. Neither can flatter the other, and a reader can
tell which they are looking at. The discipline generalises — it is the same reason harvests
record a displaced supermarket tomato rather than a negative emission.

**Bad.** The headline number never improves from the garden or the heap, which is
demotivating and true. A household that composts diligently sees its footprint fall only
through the food it does not buy. Some people will want the subtraction anyway, and we do
not offer it.
