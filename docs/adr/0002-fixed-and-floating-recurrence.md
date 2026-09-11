# 2. Two kinds of recurrence

Date: 2026-09-11
Status: Accepted

## Context

Household recurrence is not one thing.

"The bins go out on Tuesday" is anchored to the calendar. If you forget one week, the next
one is still Tuesday — it does not become Wednesday because you were late.

"Change the furnace filter every 90 days" is anchored to the work. If the filter was due on
1 June and you actually changed it on 20 June, the next change is 90 days after the 20th.
Treating it as a calendar rule would slowly drift the schedule into nonsense, and would
pile up four "missed" filter changes that never happened.

Off-the-shelf RRULE libraries model only the first kind.

## Decision

Schedules carry a mode:

- `fixed` — an RFC 5545 RRULE. Next due comes from the calendar.
- `floating` — an interval. Next due is the completion date plus the interval.
- `one_off` — happens once.
- `on_demand` — comes straight back when completed.

Fixed schedules materialise a horizon of upcoming instances. Non-fixed schedules have
exactly one instance outstanding at a time, because the next one cannot be known until this
one is done.

An outstanding fixed schedule surfaces its **most recent** missed occurrence, not its
first. A yearly job skipped twice is owed for this year.

The RRULE subset is implemented in-house rather than pulled in. It is about 200 lines,
covers what household schedules actually use, and puts month-end behaviour under our own
tests. It also removed a CommonJS dependency that would not load under Node's ESM loader.

## Consequences

**Good.** Both mental models are represented honestly. Generation is idempotent against a
unique index on (schedule, due date), which is what makes catching up after downtime safe.

**Bad.** We own an RRULE implementation. It does not support `BYSETPOS`, `BYWEEKNO`,
`BYYEARDAY` or sub-daily frequencies. Nothing in a household has needed them; if something
does, the parser is the only place to change.
