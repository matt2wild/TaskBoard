# 1. A modular monolith on SQLite

Date: 2026-09-11
Status: Accepted

## Context

Homestead is deployed by one person onto one machine for one household. The realistic
deployment target is a NAS, a mini PC or a Raspberry Pi. The people who will run it are
not operators, and the cost of an operational problem is that the household stops trusting
the reminders.

The requirements call for ten feature modules that are deliberately entangled: completing
maintenance moves stock and money; a project's budget is a view over transactions
attributed to it; a pet's food run-out date comes from the pantry.

## Decision

One process, one container, one SQLite file. Modules are directories with a service layer,
not services. Cross-module work happens through direct service calls inside the same
transaction where consistency matters, and through a small event hook where it does not.

PostgreSQL is supported through the same ORM for households that already run one, but it
is never required.

## Consequences

**Good.** Deployment is `docker compose up`. A backup is one file plus one directory.
Stock decrements and money writes are transactional without a distributed transaction. The
whole test suite runs against an in-memory database in seconds.

**Bad.** SQLite serialises writes; a household with many simultaneous writers would feel
it. WAL mode and short transactions make this a non-issue at ten users, and the Postgres
path exists if that assumption ever breaks.

**Accepted.** Module boundaries are a convention, not a wall. The registry of entity types
in `core/registry.ts` is the one place polymorphic links are allowed to know about every
module, and it is deliberately the only such place.
