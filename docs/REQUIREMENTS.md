# Homestead — Self-Hosted Home Management Platform
## Product Requirements Document

| Field | Value |
|---|---|
| Document version | 1.0 |
| Status | Draft for review |
| Date | 2026-09-11 |
| Owner | Matt Wild |
| Predecessor | TaskBoard (React kanban prototype in this repository) |

> **Naming note.** "Homestead" is a working name for the product. It is used throughout so that requirements can refer to the system by name. Rename freely; nothing else depends on it.

---

## Table of Contents

1. [Vision and Goals](#1-vision-and-goals)
2. [Scope](#2-scope)
3. [Users, Personas and Household Model](#3-users-personas-and-household-model)
4. [Guiding Principles](#4-guiding-principles)
5. [System Overview and Module Map](#5-system-overview-and-module-map)
6. [Cross-Cutting Requirements](#6-cross-cutting-requirements)
7. [Module: Core Tasks and Scheduling](#7-module-core-tasks-and-scheduling)
8. [Module: Home and Asset Registry](#8-module-home-and-asset-registry)
9. [Module: Maintenance](#9-module-maintenance)
10. [Module: Renovation Project Planning](#10-module-renovation-project-planning)
11. [Module: Budgeting](#11-module-budgeting)
12. [Module: Food and Pantry](#12-module-food-and-pantry)
13. [Module: General Storage](#13-module-general-storage)
14. [Module: Tools](#14-module-tools)
15. [Module: Cat Health](#15-module-cat-health)
16. [Module: Contacts and Vendors](#16-module-contacts-and-vendors)
17. [Module: Documents and Attachments](#17-module-documents-and-attachments)
18. [Module: Dashboard, Notifications and Reminders](#18-module-dashboard-notifications-and-reminders)
19. [Module Integration Matrix](#19-module-integration-matrix)
20. [Data Model](#20-data-model)
21. [API Requirements](#21-api-requirements)
22. [User Experience Requirements](#22-user-experience-requirements)
23. [Non-Functional Requirements](#23-non-functional-requirements)
24. [Self-Hosting, Deployment and Operations](#24-self-hosting-deployment-and-operations)
25. [Security and Privacy](#25-security-and-privacy)
26. [Recommended Technical Architecture](#26-recommended-technical-architecture)
27. [Delivery Plan and Milestones](#27-delivery-plan-and-milestones)
28. [Acceptance Criteria and Test Strategy](#28-acceptance-criteria-and-test-strategy)
29. [Risks and Mitigations](#29-risks-and-mitigations)
30. [Open Questions and Assumptions](#30-open-questions-and-assumptions)
31. [Glossary](#31-glossary)
32. [Appendix A: Requirement ID Index](#appendix-a-requirement-id-index)
33. [Appendix B: Seed Data and Defaults](#appendix-b-seed-data-and-defaults)
34. [Appendix C: Example User Journeys](#appendix-c-example-user-journeys)

---

## Requirement Conventions

Every requirement has a stable ID (`PREFIX-NNN`), a priority, and an acceptance hint.

**Priority (MoSCoW):**

| Code | Meaning |
|---|---|
| **M** | Must have. Required for the release in which the module ships. |
| **S** | Should have. Important; ship unless it costs the release date. |
| **C** | Could have. Nice to have; implement if cheap. |
| **W** | Won't have (this cycle). Explicitly deferred; recorded so nobody re-argues it. |

**ID prefixes:**

| Prefix | Area |
|---|---|
| GEN | General / cross-cutting |
| AUTH | Identity, accounts, authorization |
| TASK | Core tasks and scheduling |
| ASSET | Home and asset registry |
| MAINT | Maintenance |
| RENO | Renovation project planning |
| BUD | Budgeting |
| FOOD | Food and pantry |
| STOR | General storage |
| TOOL | Tools |
| CAT | Cat health |
| CONT | Contacts and vendors |
| DOC | Documents and attachments |
| DASH | Dashboard, notifications, reminders |
| INT | Cross-module integration |
| API | API |
| UX | User experience |
| NFR | Non-functional |
| OPS | Self-hosting and operations |
| SEC | Security and privacy |

Words such as *shall*, *must* and *should* are used in the RFC 2119 sense.

---

## 1. Vision and Goals

### 1.1 Problem statement

Running a household generates a sprawl of small, loosely related facts: when the furnace filter was last changed, how many cans of cat food are left, which bin the Christmas lights went into, whether the impact driver's second battery is dead, what the bathroom remodel has cost so far, and when the cat's next rabies booster is due. Today these facts live in spreadsheets, notes apps, paper folders, receipts in drawers, and memory. Because they are not connected, nothing reminds you that the pantry item you just bought belongs to the "cat food" budget line, that the drywall project needs a tool you lent to a neighbour, or that the water heater's warranty expires next month.

Commercial "home inventory" or "home maintenance" apps are cloud-only, subscription-priced, single-purpose, and treat the data as theirs. None of them integrate budgeting, food, storage, tools, projects and pet health in one place.

### 1.2 Vision

Homestead is a **self-hosted, single-household, multi-user web application** that acts as the household's operating system. It keeps a canonical record of the home, the things in it, the work done to it, the money spent on it, the food in it, and the animals living in it, and it **connects those records** so that each module makes the others smarter.

### 1.3 Goals

| # | Goal | Measure |
|---|---|---|
| G1 | One place for all household operational data | Every module listed in scope ships and is usable end to end. |
| G2 | Modules are integrated, not siloed | The integration matrix in section 19 is fully implemented for Must-priority links. |
| G3 | Own your data | 100% of user data exportable in open formats; runs fully offline from the internet. |
| G4 | Low operational burden | One `docker compose up` to run; backups are a single file/directory; upgrades are a container pull. |
| G5 | Fast daily capture | Common capture actions (log a purchase, check off a chore, scan a pantry item, record a cat's weight) take under 15 seconds on a phone. |
| G6 | Trustworthy reminders | Users can rely on the app to surface what needs doing today without opening every module. |

### 1.4 Non-goals

- Not a general personal finance product that competes with full accounting tools (no double-entry ledger, no investment tracking, no tax preparation).
- Not a smart-home controller (no direct device control; optional read-only integrations only, and deferred).
- Not a multi-tenant SaaS. One deployment equals one household. Multi-household support is explicitly out of scope.
- Not a recipe social network. Recipes exist only in service of pantry and meal planning.
- Not a veterinary medical record system for clinics. Cat health is owner-side tracking.

---

## 2. Scope

### 2.1 In scope (this document)

| Area | Summary |
|---|---|
| Core tasks and scheduling | Tasks, checklists, recurring chores, kanban and calendar views (evolution of the existing TaskBoard). |
| Home and asset registry | The property, its rooms and locations, and the appliances/systems/fixtures in it. |
| Maintenance | Recurring and one-off maintenance schedules, service history, warranties, manuals. |
| Renovation project planning | Multi-phase projects with tasks, dependencies, materials, quotes, permits, contractors, photos, and budgets. |
| Budgeting | Categories, budgets, transactions, recurring bills, project budgets, goals, reporting, CSV import. |
| Food and pantry | Multiple storage areas, item quantities, expiry tracking, barcode scanning, shopping lists, optional recipes and meal planning. |
| General storage | Hierarchical locations, containers, item catalogue, QR/label printing, "where is X" search, lending. |
| Tools | Tool inventory, consumables, batteries, maintenance, loans, project tool lists. |
| Cat health | Pet profiles, vaccinations, medications, vet visits, weight, diet, symptoms journal, insurance, documents. |
| Contacts and vendors | Contractors, vets, suppliers, and their association with assets, projects and transactions. |
| Documents and attachments | File storage with linking to any entity, OCR-optional, receipt capture. |
| Dashboard and notifications | Home dashboard, reminders, multi-channel notifications. |
| Platform | Self-hosting, auth, multi-user, backup, API, PWA, import/export. |

### 2.2 Explicitly out of scope

- Bank account synchronisation (Plaid/Open Banking). CSV/OFX import only.
- Native iOS/Android apps. PWA only.
- Real-time collaboration (simultaneous editing with conflict resolution). Last-write-wins with optimistic concurrency is sufficient.
- Public sharing / guest links.
- Pets other than cats in the first release. The data model shall be species-agnostic so that dogs and others can be added later without migration pain (see CAT-001).
- Smart-home device control.
- AI-driven features (receipt parsing by LLM, photo item recognition). Design hooks are noted where they would fit, but they are Won't-have for this cycle.

---

## 3. Users, Personas and Household Model

### 3.1 Household model

- A deployment represents exactly **one household**.
- A household has **one or more members**, each with their own login.
- A household has **one or more properties** (primary home, a rental unit, a cabin). Most data is scoped to a property; some (budget, contacts, pets) is household-wide.
- Some entities are **personal** (a private task list) while most are **shared**. Visibility is controlled per entity where it matters (see AUTH-010).

### 3.2 Personas

| Persona | Description | Primary needs |
|---|---|---|
| **The Operator** (Matt) | Sets up and maintains the server. Does most projects and maintenance. Wants full data control and power-user views. | Bulk edit, keyboard-driven capture, complete export, API access, project planning depth. |
| **The Co-Householder** | Partner or housemate. Uses the app mostly on a phone. Wants to know what needs doing, what we have, and what things cost, without administering anything. | Simple dashboard, shopping list, pantry scanning, chore check-off, cat med reminders. |
| **The Occasional Helper** | Family member or house-sitter with limited access for a period. | Read a specific cat's medication schedule and feeding instructions; check off chores assigned to them. Nothing else. |
| **The Future Self** | The same operator in five years, or the next owner of the house. | Reliable history: when was the roof done, by whom, for how much, with what warranty. |

### 3.3 Roles

| Role | Capabilities |
|---|---|
| **Admin** | Everything. Manages members, settings, backups, integrations. At least one admin must always exist. |
| **Member** | Full read/write on all shared data. Cannot manage members or system settings. |
| **Limited** | Read/write only on entities explicitly shared with them (assigned tasks, a pet's care sheet). Default for house-sitters. |
| **Read-only** | Read all shared data, write nothing. Useful for a family accountant or auditor. |

---

## 4. Guiding Principles

1. **Capture first, organise later.** Every module has a fast "quick add" path that requires only the minimum fields; enrichment can happen afterwards.
2. **Everything links.** Any record can attach documents, link to a transaction, reference a location, and appear on the calendar. Integration is the product.
3. **The house outlives the software.** All data is exportable in documented, open formats, and the export is complete enough to rebuild the database.
4. **Local by default.** The application must be fully functional with no outbound internet access. External lookups (barcode databases, weather) are optional enhancements that degrade gracefully.
5. **Boring technology, one process.** Prefer a single container with an embedded database over a fleet of services. Complexity in the deployment is a bug.
6. **Mobile is the capture device, desktop is the planning device.** Design the phone experience around scanning, tapping and dictation; design the desktop experience around tables, drag-and-drop and bulk edit.
7. **Reminders must be trusted.** A reminder that fires late, twice, or not at all is a critical bug, not a papercut.
8. **No lock-in to Homestead's own conventions.** Use RFC 5545 for recurrence, ISO 4217 for currency, ISO 8601 for dates, GS1 barcodes for products, UCUM-compatible units where practical.

---

## 5. System Overview and Module Map

```
┌────────────────────────────────────────────────────────────────────────────┐
│                               Dashboard / Today                            │
│        (reminders, due items, low stock, expiring food, budget status)     │
└────────────────────────────────────────────────────────────────────────────┘
        ▲            ▲             ▲             ▲             ▲
        │            │             │             │             │
┌───────┴────┐ ┌─────┴──────┐ ┌────┴─────┐ ┌─────┴─────┐ ┌─────┴─────┐
│ Maintenance│ │ Renovation │ │  Food &  │ │  General  │ │    Cat    │
│            │ │  Projects  │ │  Pantry  │ │  Storage  │ │  Health   │
└──────┬─────┘ └─────┬──────┘ └────┬─────┘ └─────┬─────┘ └─────┬─────┘
       │             │             │             │             │
       │      ┌──────┴──────┐      │             │             │
       │      │    Tools    │      │             │             │
       │      └──────┬──────┘      │             │             │
       ▼             ▼             ▼             ▼             ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  Shared services: Tasks & Scheduling · Budget · Asset/Location Registry ·  │
│  Contacts & Vendors · Documents · Notifications · Search · Audit · Auth    │
└────────────────────────────────────────────────────────────────────────────┘
```

**Layering rule:** Feature modules (top row) may depend on shared services (bottom row) and on each other only through the documented integration points in section 19. Shared services never depend on feature modules.

---

## 6. Cross-Cutting Requirements

### 6.1 General

| ID | Pri | Requirement |
|---|---|---|
| GEN-001 | M | The system shall be a web application accessible from modern evergreen browsers (last two major versions of Chrome, Firefox, Safari, Edge) on desktop and mobile. |
| GEN-002 | M | The system shall function fully without internet access from the server or the client, except for explicitly optional external lookups. |
| GEN-003 | M | Every user-created record shall carry `created_at`, `created_by`, `updated_at`, `updated_by`. |
| GEN-004 | M | Deletion of user-created records shall be soft (a `deleted_at` timestamp) with an admin-visible "trash" allowing restore for 30 days (configurable) before permanent purge. |
| GEN-005 | M | Every entity type shall support free-form **tags** (household-wide tag vocabulary with colour and optional description). |
| GEN-006 | M | Every entity type shall support a free-form **notes** field with Markdown rendering. |
| GEN-007 | M | Every entity type shall support **attachments** (see section 17) and **links** to any other entity (polymorphic `entity_link`). |
| GEN-008 | M | The system shall provide a global search across all modules that returns typed results (e.g. "Tool: Impact driver", "Pantry: Black beans") with keyboard navigation. Results shall respect the caller's permissions. |
| GEN-009 | M | The system shall maintain an **activity log** (audit trail) of create/update/delete on all entities, recording actor, timestamp, entity, and a field-level diff. Admins can view the log; members can view the log of any entity they can read. |
| GEN-010 | M | All dates shall be stored in UTC with the household's configured timezone used for display and for scheduling "wall clock" reminders. All-day dates (e.g. expiry dates) shall be stored as calendar dates without a time component. |
| GEN-011 | M | The system shall support a single household currency (ISO 4217) with per-transaction override for foreign purchases. |
| GEN-012 | M | The system shall support both metric and imperial units, with a household default and per-field override, and shall convert between them for display. |
| GEN-013 | S | The system shall support custom fields on major entity types (asset, tool, storage item, pantry product, pet) defined by an admin: text, number, date, boolean, enum, URL. |
| GEN-014 | S | The system shall support saved views (filters + sort + column selection) per list, per user, with the option to share a view household-wide. |
| GEN-015 | S | The system shall support bulk operations on list views: multi-select, bulk tag, bulk move (location), bulk delete, bulk assign. |
| GEN-016 | S | The UI shall be localisable (string externalisation) with English as the only shipped language. |
| GEN-017 | C | The system shall expose an iCalendar (ICS) feed per user and per household for all dated items (tasks, maintenance due, vet appointments, project milestones, bill due dates), protected by a per-feed secret token. |
| GEN-018 | M | The system shall provide a complete data export (see OPS-020) and an import that restores it. |
| GEN-019 | M | The system shall show an "undo" affordance for the most recent destructive action (delete, bulk move, check-off) for at least 10 seconds. |
| GEN-020 | S | The system shall support entity-level comments (threaded discussion between household members) on tasks, projects, assets and pets. |

### 6.2 Identity and authorization

| ID | Pri | Requirement |
|---|---|---|
| AUTH-001 | M | The system shall support local accounts with username/email + password. Passwords hashed with Argon2id. |
| AUTH-002 | M | The first account created on a fresh install shall be an Admin, created via a guided setup wizard. |
| AUTH-003 | M | Admins shall be able to invite members by generating a single-use invite link with an expiry and a pre-assigned role. |
| AUTH-004 | M | Sessions shall be cookie-based (HttpOnly, Secure when served over HTTPS, SameSite=Lax) with configurable lifetime and "remember me". |
| AUTH-005 | S | The system shall support TOTP two-factor authentication per account, with recovery codes. |
| AUTH-006 | S | The system shall support OpenID Connect login against an external identity provider (Authelia, Authentik, Keycloak, Pocket ID) with role mapping from a configurable claim. Local login remains available unless disabled by an admin. |
| AUTH-007 | S | The system shall support trusted-header authentication (e.g. `Remote-User` from a reverse proxy) restricted to a configured list of proxy IPs. |
| AUTH-008 | M | The system shall implement the four roles in section 3.3. Authorization checks shall be enforced server-side on every API call. |
| AUTH-009 | M | Personal API tokens shall be issuable per user, scoped to read or read/write, revocable, with last-used tracking. |
| AUTH-010 | M | Entities shall have a visibility of `household` (default) or `private` (creator only). Limited-role users see only entities explicitly shared with them via an assignment or a share record. |
| AUTH-011 | M | Admins shall be able to deactivate (not delete) a member; their historical attributions remain intact. |
| AUTH-012 | S | Failed login attempts shall be rate-limited per account and per IP with exponential backoff. |
| AUTH-013 | C | Admins shall be able to require re-authentication for sensitive actions (export, member management, backup download). |

---

## 7. Module: Core Tasks and Scheduling

The task engine is the shared scheduling substrate. Maintenance schedules, project tasks, chores, pet medication doses, and bill due dates all produce **task instances** that appear in the same lists, calendar and reminders. The existing TaskBoard prototype (lanes, cards, drag-and-drop, `repeat`, `prereqs`, `children`, `persistant`) is the seed for this module.

### 7.1 Concepts

- **Task**: a unit of work with a title, optional description, status, due date/time, assignee(s), priority, effort estimate, tags, links, subtasks, and checklist items.
- **Task template / schedule**: a definition that generates task instances on a recurrence rule. Recurrence uses RFC 5545 RRULE plus two Homestead-specific modes: **fixed** (next due is computed from the schedule regardless of completion, e.g. "trash every Tuesday") and **floating** (next due is computed from the last completion, e.g. "change filter 90 days after last change").
- **Board**: a kanban arrangement of tasks in lanes. A board is a view over tasks, not a container; a task may appear on many boards.
- **Lane**: a column on a board with either a status mapping (To do / Doing / Done) or a free-form grouping (as in the prototype's "automations", "this week" lanes).

### 7.2 Requirements

| ID | Pri | Requirement |
|---|---|---|
| TASK-001 | M | Users shall create tasks with title only ("quick add") from any screen via a global shortcut and a mobile FAB. Natural-language due parsing ("tomorrow 5pm", "next tue", "in 3 weeks") shall be supported. |
| TASK-002 | M | Tasks shall have: title, description (Markdown), status (`open`, `in_progress`, `blocked`, `done`, `cancelled`), priority (`low`, `normal`, `high`, `urgent`), due date (date or datetime), start date, assignees (0..n members), estimated effort (minutes), actual effort, tags, parent task, checklist items, links, attachments. |
| TASK-003 | M | Tasks shall support **subtasks** (one level of parent/child is Must; arbitrary depth is Should). A parent's progress shall show completed/total children. |
| TASK-004 | M | Tasks shall support **dependencies** (`blocked_by`). A task with unfinished blockers is displayed as blocked. Circular dependencies shall be rejected. |
| TASK-005 | M | Recurring tasks shall be defined via a schedule with RRULE (daily, weekly on days, monthly on date or ordinal weekday, yearly, custom interval) and a mode of `fixed` or `floating`. |
| TASK-006 | M | Recurring instance generation shall be lazy and idempotent: the next N instances (default 1 for floating, up to the horizon for fixed) exist as real task rows; completing one generates the next. Editing the schedule shall offer "this instance only" vs "this and future". |
| TASK-007 | M | Completing a task shall record completion timestamp, completing member, optional note, and optional actual effort. For tasks originating from another module (maintenance, medication), completion shall invoke that module's completion hook (see INT). |
| TASK-008 | M | The system shall provide list views: **Today**, **Upcoming** (grouped by day for 14 days), **Overdue**, **Assigned to me**, **All** with filters (status, assignee, tag, module of origin, property, priority). |
| TASK-009 | M | The system shall provide a **kanban board** view with drag-and-drop between lanes and within lanes (ordering persisted), configurable lanes per board, and WIP limits (Should). |
| TASK-010 | M | The system shall provide a **calendar** view (month, week, agenda) showing tasks and all dated items from other modules with per-module colour coding and toggles. |
| TASK-011 | M | Tasks shall be snoozeable (push due date by preset or custom amount) and reschedulable via drag on the calendar. |
| TASK-012 | S | The system shall support **checklists** within a task (ordered items with done state), and checklist **templates** (e.g. "Spring opening checklist") that can be instantiated. |
| TASK-013 | S | Boards shall support **automations** in the spirit of the prototype's "automations" lane: rules of the form *when [event] then [action]*, e.g. "when task moved to Done, set status done", "when task tagged `shopping`, add to shopping list". Initial rule set is fixed; a rule builder is Could. |
| TASK-014 | S | Tasks shall support time tracking (start/stop timer, manual entry) aggregated to projects. |
| TASK-015 | S | Users shall be able to convert a task to a project (RENO) or to a maintenance schedule (MAINT), preserving history. |
| TASK-016 | C | Task assignment rotation: a recurring chore may rotate assignee among a member list on each instance. |
| TASK-017 | M | A task shall record its **origin** (`manual`, `maintenance`, `project`, `pet_medication`, `pet_appointment`, `bill`, `shopping`, `automation`) and a reference to the originating entity; origin-derived tasks link back to their source. |
| TASK-018 | S | Bulk reschedule of overdue tasks ("move all overdue to today") shall be available from the Overdue view. |
| TASK-019 | C | The prototype's `persistent` flag (task that returns to the board after completion without a schedule) shall be supported as a schedule mode `on_demand_repeat`. |

---

## 8. Module: Home and Asset Registry

The registry is the physical model of the household: properties, spaces, and the durable things in them. Maintenance attaches to assets; storage attaches to locations; projects attach to spaces; costs attach to all of them.

### 8.1 Concepts

- **Property**: a building or parcel. Address, type (house, condo, rental, land), purchase date/price, square footage, year built, lot size, notes, documents (deed, survey, insurance).
- **Location**: a node in a tree under a property: *floor → room → area → container*. The same tree serves storage (STOR) and asset placement. Location types: `floor`, `room`, `zone` (e.g. "north wall", "under sink"), `container` (bin, shelf, cabinet, drawer), `exterior`, `vehicle` (Could).
- **Asset**: a durable item that has a lifecycle worth tracking: appliances (fridge, washer), systems (HVAC, water heater, sump pump, well pump, septic), fixtures (roof, windows, deck, fence), major electronics, vehicles (Could). Not consumables, not small tools (tools have their own module but share the asset base).
- **Asset category**: hierarchical taxonomy (Appliances → Kitchen → Refrigerator) with category-level default maintenance templates.

### 8.2 Requirements

| ID | Pri | Requirement |
|---|---|---|
| ASSET-001 | M | Admins shall create one or more properties; every location, asset and project belongs to exactly one property. A single-property household shall never be forced to see property selectors. |
| ASSET-002 | M | Locations shall form a tree of arbitrary depth with drag-and-drop reorganisation. Moving a location moves all descendants and their contents. |
| ASSET-003 | M | Locations shall have: name, type, parent, description, photo, dimensions (Could), and a generated short code for labelling (e.g. `GAR-S3-B12`). |
| ASSET-004 | M | Assets shall have: name, category, make, model, serial number, location, purchase date, purchase price, purchase vendor, purchase transaction link, installation date, warranty expiry, expected lifespan (years), condition (`new`, `good`, `fair`, `poor`, `failed`, `retired`), status (`active`, `in_storage`, `retired`, `disposed`), photos, manuals, notes, custom fields. |
| ASSET-005 | M | Assets shall display a computed **age**, **remaining warranty**, **estimated remaining life**, and **total cost of ownership** (purchase + linked maintenance and repair transactions). |
| ASSET-006 | M | Assets shall have a full **history timeline** aggregating: maintenance completions, repairs, transactions, project involvement, location moves, condition changes, and notes. |
| ASSET-007 | M | The asset category taxonomy shall ship with a sensible default set (see Appendix B) and be editable by admins. |
| ASSET-008 | S | Assets shall support **components/sub-assets** (furnace → blower motor, filter slot with filter size). Consumable specs (filter size 16x25x1, bulb type, battery type) shall be recordable on the asset and matched to pantry/storage products for reorder. |
| ASSET-009 | S | Asset **replacement planning**: from expected lifespan and age, compute a replacement year and estimated cost (user-entered or last purchase price inflated by a configurable rate), feeding the budget's long-range forecast. |
| ASSET-010 | S | Assets shall support **retire/dispose** with date, method (sold, recycled, trashed, donated), sale proceeds (linked transaction), and replacement asset link. |
| ASSET-011 | S | A **home profile** page shall summarise the property: systems overview (roof, HVAC, water heater, electrical panel, plumbing type), key measurements, paint colours per room (Could), utility providers and account numbers (encrypted, Could). |
| ASSET-012 | C | QR label printing for assets (same subsystem as STOR-020) so that scanning the label on a furnace opens its record and maintenance log. |
| ASSET-013 | C | Asset lookup by model number against a user-maintained manual library; no external API required. |

---

## 9. Module: Maintenance

### 9.1 Concepts

- **Maintenance plan**: a recurring or one-off definition of work on an asset, location, or the property ("clean gutters" is a location-level plan; "replace furnace filter" is an asset-level plan). A plan owns a schedule (TASK-005), a checklist template, required tools, required consumables, estimated duration, estimated cost, and a DIY/vendor flag.
- **Maintenance record**: a completed occurrence with date, performer (member or vendor), actual cost (transaction link), parts used (pantry/storage consumption), notes, photos, readings.
- **Repair**: an unplanned maintenance record, with a failure description and cause.
- **Reading**: a numeric measurement captured over time (water softener salt level, sump pit level, meter readings, HVAC filter pressure drop). Readings may trigger plans via thresholds (Should).

### 9.2 Requirements

| ID | Pri | Requirement |
|---|---|---|
| MAINT-001 | M | Users shall create maintenance plans attached to an asset, a location, or the property, with title, description, schedule (fixed/floating/one-off/reading-triggered), estimated duration, estimated cost, priority, assignee, checklist, required tools (TOOL refs), required consumables (product refs with quantity), instructions (Markdown), and reference documents. |
| MAINT-002 | M | Each plan shall generate task instances through the task engine (TASK-006) with origin `maintenance`. Completing the task shall create a maintenance record and, in floating mode, compute the next due date from the completion date. |
| MAINT-003 | M | Completing a maintenance task shall optionally prompt for: actual cost (creating a transaction, BUD), consumables used (decrementing pantry/storage stock, FOOD/STOR), readings, photos, notes, and performer (member or vendor). All prompts skippable. |
| MAINT-004 | M | Users shall log ad-hoc maintenance and repairs against an asset without a plan. |
| MAINT-005 | M | The system shall ship with a **library of maintenance templates** keyed by asset category (e.g. Refrigerator: clean condenser coils every 6 months; Water heater: flush annually, test T&P valve annually; Smoke detectors: test monthly, replace batteries annually, replace unit every 10 years; Gutters: clean spring and fall; HVAC: filter every 90 days, professional service annually; Dryer: clean vent annually; Sump pump: test quarterly). Creating an asset in a category shall offer to instantiate the category's templates. |
| MAINT-006 | M | A **maintenance calendar** and **upcoming list** shall show due and overdue items with property/asset grouping and a "seasonal" grouping (spring, summer, fall, winter) for plans tagged with seasons. |
| MAINT-007 | M | Each asset shall show its maintenance history and the next due date for each plan. |
| MAINT-008 | M | **Warranties**: assets shall record warranty provider, term, expiry, coverage notes, claim contact, and documents. The dashboard shall warn 60/30/7 days (configurable) before warranty expiry. Extended warranties and service contracts shall be recordable as separate warranty records with their own cost transactions. |
| MAINT-009 | S | **Readings**: users shall record timestamped numeric readings against an asset with a unit; the asset page shall chart them; a plan may be triggered when a reading crosses a threshold (e.g. "water softener salt below 25%"). |
| MAINT-010 | S | Plans shall support **vendor-performed** work: assign a vendor (CONT), record the quote and invoice documents, and the completion form shall default performer to the vendor. |
| MAINT-011 | S | **Seasonal checklists** (spring opening, winterisation) shall be modelled as a plan with a checklist template and yearly schedule, instantiable from a library. |
| MAINT-012 | S | Maintenance cost reporting: total by asset, by category, by month/year; comparison of estimated vs actual; feed into BUD reports. |
| MAINT-013 | S | The completion form shall pre-fill consumables from the plan's required consumables and show current stock; if stock is insufficient, it shall offer to add the item to the shopping list. |
| MAINT-014 | C | Plans shall support "grace windows" (a due window of ±N days shown as "due soon" rather than "overdue") to reduce alert fatigue for flexible tasks. |
| MAINT-015 | C | Import of maintenance history from CSV for existing homes. |
| MAINT-016 | M | Deleting an asset shall not delete its maintenance history; the asset is retired/soft-deleted and history remains viewable from the property. |

---

## 10. Module: Renovation Project Planning

### 10.1 Concepts

- **Project**: a bounded piece of work larger than a task: a bathroom remodel, a deck build, a whole-house repaint, a garden bed installation. Has a lifecycle (`idea` → `planning` → `approved` → `in_progress` → `on_hold` → `complete` → `cancelled`), a property and one or more locations, a budget, phases, tasks, materials, tools, vendors, permits, quotes, documents, photos, decisions, and a retrospective.
- **Phase**: an ordered stage within a project (Demo → Rough-in → Inspection → Finish). Tasks belong to phases; phases have target dates and dependencies.
- **Material line**: a quantified thing to buy or use: SKU/product, quantity, unit, estimated unit cost, actual cost, purchased flag, supplier, linked transaction, linked storage item once received.
- **Quote**: a vendor's priced proposal for some scope, with status (`requested`, `received`, `accepted`, `rejected`, `expired`), documents, and line items.
- **Permit/Inspection**: a regulatory item with authority, number, applied/issued/expiry dates, fees, inspection appointments (which are tasks), and outcome.
- **Decision log**: dated record of choices made (tile selected, layout changed) with rationale and alternatives, because renovations are made of decisions you later forget.

### 10.2 Requirements

| ID | Pri | Requirement |
|---|---|---|
| RENO-001 | M | Users shall create projects with: name, description, status, property, locations, owner, target start/end, actual start/end, priority, tags, budget (BUD link), cover photo. |
| RENO-002 | M | Projects shall have ordered **phases**; each phase has name, target start/end, status, and dependencies on other phases. Tasks belong to a phase (or the project directly). |
| RENO-003 | M | Project tasks use the task engine (TASK) with origin `project`. The project page shall offer both a **kanban** (lanes = status or phase) and a **list grouped by phase** view. |
| RENO-004 | M | Projects shall have a **materials list**: product/description, quantity, unit, estimated unit cost, estimated total, actual cost, status (`needed`, `ordered`, `received`, `installed`, `returned`), supplier (CONT), linked transaction (BUD), linked storage/pantry item (STOR) after receipt. The list shall total estimated vs actual. |
| RENO-005 | M | Projects shall have a **tools needed** list referencing TOOL records with a computed availability status (owned & available, owned but loaned out, needs repair, not owned → rent/buy). |
| RENO-006 | M | Projects shall have a **budget**: a top-line amount, optional breakdown by cost category (materials, labour, permits, tools, disposal, contingency, other), and live actuals from linked transactions. The project page shall show spent, committed (ordered but unpaid), remaining, and % of budget. Overrun thresholds (80%, 100%) shall trigger notifications. |
| RENO-007 | M | Projects shall have **quotes** with vendor, scope, amount, date, validity, status, documents, and a comparison table when multiple quotes exist for the same scope. Accepting a quote shall optionally create a committed budget line and a vendor task. |
| RENO-008 | M | Projects shall have **photos** with capture date and an optional stage tag (`before`, `during`, `after`) presented as a gallery and as a before/after timeline. |
| RENO-009 | M | Projects shall have **documents**: plans, drawings, contracts, permits, receipts, warranties (DOC). |
| RENO-010 | S | Projects shall have **permits and inspections** with authority, permit number, fee (transaction), applied/issued/expiry dates, and inspection appointments generated as tasks. |
| RENO-011 | S | Projects shall have a **decision log** (date, decision, rationale, alternatives considered, decided by, links). |
| RENO-012 | S | Projects shall have a **timeline/Gantt** view of phases and tasks with dependencies, target vs actual, and drag-to-reschedule. |
| RENO-013 | S | Projects shall support **templates** (e.g. "Bathroom remodel" with standard phases, task checklist, typical materials, typical permits). A completed project can be saved as a template. |
| RENO-014 | S | On completion, a project shall prompt for a **retrospective**: final cost vs budget, duration vs plan, what went well/poorly, and shall offer to create/update assets (new water heater installed), update the home profile (paint colours), and file leftover materials into storage. |
| RENO-015 | S | Projects shall support a **scope/ideas backlog**: items in `idea` status that are not yet approved, with rough cost estimates, feeding the budget's long-range planning (BUD-030). |
| RENO-016 | S | A **shopping run** view shall aggregate `needed` materials across active projects by supplier so a single trip covers multiple projects; purchased items can be marked in bulk and a single transaction split across projects. |
| RENO-017 | C | Room measurement helper: store room dimensions on the location; material calculators (paint coverage, tile area with waste factor, flooring) prefill material quantities. |
| RENO-018 | C | Contractor portal export: a printable/PDF project brief (scope, drawings, materials, decisions) for sharing with vendors. |
| RENO-019 | M | Projects shall roll up: total tasks/complete, hours logged, budget status, open blockers, next milestone, and show these on the dashboard for active projects. |

---

## 11. Module: Budgeting

The budgeting module is a **household cash-flow and envelope budget** tool whose distinguishing feature is that every transaction can be attributed to *what in the house it was for*: an asset, a project, a pet, a pantry purchase, a tool. It is not a bank-sync ledger and not double-entry accounting.

### 11.1 Concepts

- **Account**: a source/destination of money (checking, credit card, cash, savings, "house fund"). Balances are derived from transactions plus an opening balance. Accounts are optional; a household can run purely on categories.
- **Category**: hierarchical spending/income category (Home → Maintenance → HVAC). Ships with a default tree tuned to home management.
- **Transaction**: dated money movement with amount, direction (expense/income/transfer), account, payee (CONT or free text), category, memo, tags, **attributions** (one or more of: asset, project, pet, tool, pantry purchase, maintenance record, storage item), receipt attachment, and **splits** (multiple category/attribution lines summing to the total).
- **Budget**: for a period (monthly by default; yearly and custom), an allocation per category, with rollover rules. Also **project budgets** (RENO-006) and **savings goals**.
- **Recurring bill**: a scheduled expected transaction (mortgage, utilities, insurance, pet insurance, subscriptions) that generates a `bill` task and, on payment, a transaction.
- **Goal**: a target amount by a target date (new roof fund) with contributions tracked.

### 11.2 Requirements

| ID | Pri | Requirement |
|---|---|---|
| BUD-001 | M | Users shall record transactions with: date, amount, currency (default household), type (`expense`, `income`, `transfer`), account (optional), payee, category, memo, tags, attachments (receipt), and one or more attributions to other-module entities. |
| BUD-002 | M | Transactions shall support **splits**: N lines each with amount, category and attribution, validated to sum to the transaction total. |
| BUD-003 | M | A **quick capture** flow on mobile shall create a transaction from: amount, payee, category, and an optional receipt photo, in under four taps plus typing. Payee and category shall auto-suggest from history. |
| BUD-004 | M | The category tree shall be editable; categories can be archived but not deleted while referenced. Default tree shipped (Appendix B). |
| BUD-005 | M | **Monthly budgets**: allocate an amount per category per month; show budgeted, spent, remaining, and a progress bar; support copying last month, and rollover rules per category (`none`, `carry_positive`, `carry_all`). |
| BUD-006 | M | **Reports**: spending by category (period, pie/bar), spending over time (line), income vs expense, spending by attribution type (how much on the house vs pets vs food), by asset, by project, by pet, by vendor. All reports exportable to CSV. |
| BUD-007 | M | **Recurring bills**: define payee, amount (fixed or variable with estimate), category, schedule (RRULE), account, auto-create a `bill` task N days before due; marking paid creates the transaction and completes the task; variable bills prompt for the amount. |
| BUD-008 | M | **CSV import** of transactions from bank exports with a column-mapping UI, saved mapping profiles per bank, duplicate detection (date+amount+payee hash), and a review step before commit. OFX/QFX import is Should. |
| BUD-009 | M | Every other module that captures cost (MAINT-003, RENO-004, FOOD-011, TOOL-004, CAT-013) shall create transactions through a single shared "attach cost" component so behaviour is consistent. |
| BUD-010 | M | The dashboard budget widget shall show current month: total spent vs budgeted, top three over-budget categories, upcoming bills in the next 7 days. |
| BUD-011 | S | **Accounts** with opening balance, derived balance, and a reconciliation flow (mark transactions cleared, enter statement balance, show difference). |
| BUD-012 | S | **Transfers** between accounts as a single transaction affecting two accounts. |
| BUD-013 | S | **Savings goals**: name, target amount, target date, linked account (optional), contributions (transactions tagged to the goal), projected completion date at current rate. |
| BUD-014 | S | **Annual/irregular expense smoothing**: for yearly bills (insurance, property tax), show the monthly set-aside amount and track accumulation ("sinking funds"). |
| BUD-015 | S | Budget **alerts**: category at 80%/100% of allocation, project at 80%/100%, bill overdue, unusual transaction (> 2× the category's 12-month average, Could). |
| BUD-016 | S | **Payee management**: merge duplicates, default category per payee, link payee to a CONT vendor. |
| BUD-017 | S | Receipt capture: photo → attachment; user enters amount and items. OCR hook point noted but Won't-have. Line items on a receipt may be entered manually and each linked to a pantry product for price history (FOOD-014). |
| BUD-018 | S | **Price history**: for any product (pantry, consumable, material), show historic unit prices by vendor from linked transaction line items. |
| BUD-019 | C | Multi-currency transactions with a manually entered exchange rate; reports in household currency. |
| BUD-020 | C | Budget templates ("copy last year's plan +3%"). |
| BUD-030 | S | **Long-range planning view**: a 1–10 year projection combining asset replacement forecasts (ASSET-009), project backlog estimates (RENO-015), and savings goals, shown per year with a "funded / unfunded" indicator. |
| BUD-031 | M | Amounts shall be stored as integer minor units (cents) to avoid floating-point error. |
| BUD-032 | S | Transactions and budgets shall support **household member attribution** (who paid) and an optional "shared/personal" flag; a "who owes whom" settlement summary is Could. |

---

## 12. Module: Food and Pantry

### 12.1 Concepts

- **Storage area** (pantry): a food-holding location: kitchen pantry, fridge, freezer, garage chest freezer, spice rack, bar. These are STOR locations flagged `holds_food`, with a temperature class (`ambient`, `refrigerated`, `frozen`).
- **Product**: a catalogue entry for a kind of food: name, brand, barcode(s), category, default unit, package size, typical shelf life per temperature class, image, nutrition (optional), price history, preferred vendors, tags (vegan, gluten-free, cat-related).
- **Stock item (lot)**: a physical quantity of a product in an area: quantity (count or measure), unit, opened flag/date, expiry or best-before date, purchase date, purchase transaction link, lot notes.
- **Shopping list**: one or more lists (grocery, hardware, pet store), each with lines (product or free text, quantity, note, store, checked state), auto-populated from low-stock rules and from other modules.
- **Recipe** (Should): ingredients (product refs with quantity), steps, servings, tags; supports "can I make this" against stock and "add missing to list".
- **Meal plan** (Could): calendar of recipes/meals per day; generates a consolidated shopping list.

### 12.2 Requirements

| ID | Pri | Requirement |
|---|---|---|
| FOOD-001 | M | Users shall define any number of food storage areas (as STOR locations) with a temperature class and optional sub-areas (freezer drawer 2, door shelf). |
| FOOD-002 | M | Users shall maintain a **product catalogue** with name, brand, category (hierarchical, shipped default), barcodes (many per product), default unit, package size, default shelf-life per temperature class, image, notes, tags. |
| FOOD-003 | M | Users shall add stock by: (a) scanning a barcode with the phone camera (in-browser barcode detection; no native app), (b) searching the catalogue, (c) free text creating a new product. Scanning an unknown barcode shall create a product stub and optionally look it up against Open Food Facts if internet access is enabled (opt-in, FOOD-020). |
| FOOD-004 | M | Stock items shall record quantity, unit, area, expiry/best-before (defaulted from product shelf life + today, editable), opened date, purchase date, price (creating/linking a transaction is optional). |
| FOOD-005 | M | The system shall track quantities in counts (3 cans) and measures (1.2 kg, 750 ml) with partial consumption ("used half"). |
| FOOD-006 | M | **Consume/adjust** actions shall be one-tap from the stock list and from scanning: `use 1`, `use all`, `set quantity`, `mark opened`, `throw away (waste)` with reason. |
| FOOD-007 | M | **Expiry tracking**: list items expiring within N days (default 7), items expired, colour-coded; dashboard widget; daily digest notification. Opened items shall use "use within X days after opening" if defined on the product. |
| FOOD-008 | M | **Low stock / par levels**: a product may have a minimum quantity per household; falling below it adds the product to the default shopping list automatically (toggle per product). |
| FOOD-009 | M | **Shopping lists**: multiple named lists; lines with product or free text, quantity, note, preferred store (CONT vendor); check-off; "checked" lines move to a collapsed done section; lists are live-shared across members (near-real-time via polling or SSE). |
| FOOD-010 | M | Checking off shopping lines shall offer a **"put away" flow**: confirm quantity and area for each purchased product, creating stock items with default expiry, in a single batch. |
| FOOD-011 | M | The put-away flow shall optionally attach the whole trip to a single transaction (BUD-009) with a grocery category, and optionally distribute the receipt total across items for price history (FOOD-014). |
| FOOD-012 | M | Stock views: by area, by category, by expiry, search; each shows total quantity per product and per-lot detail. |
| FOOD-013 | S | **Waste log**: items thrown out with reason (expired, spoiled, disliked, excess); monthly waste report by product and category with estimated cost. |
| FOOD-014 | S | **Price history** per product per vendor from transactions; show last paid, lowest, average; suggest cheapest store on the shopping list. |
| FOOD-015 | S | **Recipes**: ingredients (product refs + qty + unit), steps, servings, prep/cook time, tags, photo, source URL. "Can I make it?" evaluates stock; "Add missing to list" adds shortfalls. Cooking a recipe decrements stock (confirmable). |
| FOOD-016 | S | **Cat food integration**: products tagged as pet food are linked to a pet's diet (CAT-011); daily feeding amounts drive a projected run-out date and auto-add to the shopping list. |
| FOOD-017 | C | **Meal planning** calendar with drag-and-drop recipes, generating a consolidated shopping list for a date range. |
| FOOD-018 | C | Nutrition totals per recipe from product nutrition data. |
| FOOD-019 | S | Location-aware **scan mode**: choose an area once, then scan repeatedly to add/consume items rapidly (restock session), with audio/haptic feedback. |
| FOOD-020 | S | Optional external product lookup (Open Food Facts) behind an admin toggle, with attribution, and caching of results locally. Default off. |
| FOOD-021 | S | **Inventory audit** mode: walk an area and confirm/correct quantities item by item; unconfirmed items are flagged. |
| FOOD-022 | C | Household **staples list**: products always expected on hand, shown as a checklist for a weekly stock check. |
| FOOD-023 | M | Non-food household consumables (toilet paper, detergent, filters, batteries, cat litter) shall use the same product/stock machinery with `is_food=false`, so that pantry logic (par levels, shopping, put-away) applies household-wide. Views shall be able to filter food vs non-food. |

---

## 13. Module: General Storage

### 13.1 Concepts

- **Location** tree shared with ASSET (section 8), extended with containers (bins, totes, boxes, shelves, drawers, cabinets, pegboards, closets).
- **Storage item**: a thing you own and want to find later that is not an asset, tool, or consumable stock: seasonal decorations, camping gear, spare parts, cables, keepsakes, documents-in-a-box, leftover renovation materials. Fields: name, description, category, quantity, location (container), photo(s), value (estimated, for insurance), purchase info, condition, tags, "keep until" review date, loan state.
- **Label**: a printable code (QR + human-readable short code) for a location or container that opens the record when scanned.
- **Loan**: an item lent to or borrowed from a person (CONT), with dates and return state.

### 13.2 Requirements

| ID | Pri | Requirement |
|---|---|---|
| STOR-001 | M | Users shall create storage items with name only (quick add) and enrich later with the fields above. Photo capture from camera shall be one tap. |
| STOR-002 | M | Every storage item shall have a location (a container or a room-level location). Unlocated items appear in an "Unsorted" inbox. |
| STOR-003 | M | **"Where is X?"**: global search shall return storage items with a breadcrumb path (Garage → Shelf 3 → Bin 12) and a photo of the container if present. |
| STOR-004 | M | **Container view**: opening a container shows its contents, its photo, its parent path, and sibling containers; contents can be moved to another container via drag-and-drop or multi-select "move to". |
| STOR-005 | M | Items and containers shall be **movable** with history (location change log visible on the item). |
| STOR-006 | M | **Categories** shipped by default (Seasonal, Camping, Sports, Electronics, Cables & Adapters, Spare Parts, Keepsakes, Documents, Clothing, Craft, Garden, Auto, Renovation Leftovers) and editable. |
| STOR-007 | S | **Value tracking** for insurance: estimated value per item, total by location and category, exportable inventory report with photos (PDF/CSV) for insurers. |
| STOR-008 | S | **Loans**: mark an item lent to a contact with an expected return date; a task is created for the return date; dashboard lists items out on loan. Borrowed items (owned by others, in our house) are trackable the same way in reverse. |
| STOR-009 | S | **Declutter review**: items with a "review by" date, or untouched (no view/edit) for N months, surface in a review queue with actions keep / sell / donate / trash, the latter three creating an optional transaction (sale proceeds) and disposing the item. |
| STOR-010 | S | **Leftover materials** from projects (RENO-014) shall be filed as storage items with a link back to the project, so that "do we still have that tile?" is answerable. |
| STOR-011 | S | Item photos shall support multiple images and a primary image; container photos shall optionally show a "photo of contents" to aid visual search. |
| STOR-012 | C | Bulk "unpack a box" mode: scan container label, then rapidly add items with camera + name. |
| STOR-020 | M | **Labels**: generate QR codes for locations, containers, assets and tools that encode a stable URL (`https://<host>/s/<code>`), printable as sheets on common label stock (Avery-style templates, at least 2 layouts) and single labels; scanning with any phone camera opens the record (login required). |
| STOR-021 | S | Short codes shall be human-typeable (e.g. `B12`) and unique per household so labels remain useful even if the QR is damaged. |
| STOR-022 | C | Support for pre-printed label rolls: admin generates a batch of unassigned codes; scanning an unassigned code prompts to bind it to a new or existing container. |

---

## 14. Module: Tools

Tools share the asset base (they are durable items with make/model/purchase/warranty/location) but have tool-specific behaviour: consumables, batteries and chargers, calibration/sharpening, project usage, and loans.

### 14.1 Concepts

- **Tool**: a hand or power tool, machine, or measuring instrument. Types: `hand`, `power_corded`, `power_battery`, `pneumatic`, `garden`, `measuring`, `safety`, `other`.
- **Battery platform**: a manufacturer battery ecosystem (DeWalt 20V MAX, Milwaukee M18, Ryobi ONE+). Batteries and chargers are tracked as tool-like records on a platform; tools declare their platform.
- **Consumable spec**: what a tool eats (blade type/size, bit type, sandpaper grit/size, string trimmer line, oil). Matched to pantry/storage products for stock and reorder.
- **Tool kit**: a named grouping (Drywall kit, Plumbing kit, Car kit) for checkout as a set.

### 14.2 Requirements

| ID | Pri | Requirement |
|---|---|---|
| TOOL-001 | M | Users shall record tools with: name, type, category, make, model, serial, photo, location (STOR container), purchase date/price/vendor/transaction, warranty, condition, status (`available`, `in_use`, `loaned_out`, `needs_repair`, `retired`), power source, battery platform, accessories/included parts, manual (DOC), notes, tags, custom fields. |
| TOOL-002 | M | Tools shall appear in the storage location tree and in "where is X" search like any storage item. |
| TOOL-003 | M | **Loans**: mark a tool loaned to a contact with expected return; task created; dashboard shows tools out on loan; returning records date and condition. Borrowed tools (from a neighbour) trackable in reverse with a "return by" task. |
| TOOL-004 | M | Tools shall support **maintenance plans** through MAINT (blade sharpening, oil change on mower, chain sharpening, calibration of a laser level) and **repairs** with cost transactions. |
| TOOL-005 | M | **Consumables**: a tool declares consumable specs (e.g. "10-inch 60T blade", "1/4-inch hex bits", "5-inch 120-grit hook-and-loop discs"). Each spec maps to one or more products in the product catalogue; the tool page shows current stock and a reorder shortcut. |
| TOOL-006 | M | **Battery platforms**: batteries and chargers are records with capacity (Ah), voltage, purchase date, health (`good`, `degraded`, `dead`), and cycle notes. A platform page shows all tools, batteries and chargers on it. |
| TOOL-007 | M | **Project integration**: RENO-005 tool lists resolve availability from tool status; starting a project phase can "check out" tools (status `in_use` with project reference); completing checks them back in. |
| TOOL-008 | S | **Kits**: named sets of tools that can be checked out/in as a unit; kit page shows completeness (missing items highlighted). |
| TOOL-009 | S | **Wishlist / gap analysis**: a project or maintenance plan requiring a tool not owned adds it to a tool wishlist with estimated cost; wishlist feeds BUD-030 planning. Rent-vs-buy note field. |
| TOOL-010 | S | **Usage log**: optional log entries (date, project/task, hours) so that "has this mower done its 25-hour service?" can be answered; hour-based maintenance triggers via MAINT-009 readings. |
| TOOL-011 | S | Tool **calibration/inspection** records (torque wrench, ladder inspection, PPE expiry) with next-due dates via MAINT. |
| TOOL-012 | C | Barcode/QR label on tool and its case (STOR-020) for scan-to-checkout. |
| TOOL-013 | C | Insurance report of tools with value and serials (shares STOR-007). |
| TOOL-014 | S | Default tool category taxonomy and common consumable spec presets shipped (Appendix B). |

---

## 15. Module: Cat Health

### 15.1 Concepts

- **Pet**: a companion animal. Species-agnostic data model (`species`, `breed`, `sex`, `neutered`, `dob`, `microchip`, `colour/markings`, `photo`, `weight history`, `status` active/deceased/rehomed) with cat-specific defaults and templates. First release ships cat presets only.
- **Health record types**: vaccination, medication (course or ongoing), preventive (flea/tick/worming), vet visit, procedure/surgery, lab result, condition/diagnosis, symptom observation, weight, dental, grooming, behaviour note, litter/elimination note.
- **Care plan**: the pet's standing instructions: feeding schedule and amounts (linked products), medications with dose schedule, litter routine, environmental notes, emergency contacts, vet. Printable/shareable with a Limited-role house-sitter.
- **Provider**: vet clinic, emergency vet, groomer, boarder, pet insurer (CONT contacts with a `pet_provider` type).

### 15.2 Requirements

| ID | Pri | Requirement |
|---|---|---|
| CAT-001 | M | The pet model shall be species-agnostic in schema; UI labels and templates (vaccination defaults, weight ranges, food categories) shall be driven by a species profile. Only the `cat` species profile ships in the first release. |
| CAT-002 | M | Users shall create pet profiles with the fields above, multiple photos, and notes. Multiple pets supported with a pet switcher. |
| CAT-003 | M | **Vaccinations**: record vaccine (from a cat preset list: FVRCP, rabies, FeLV, plus custom), date given, provider, lot/batch (optional), next due (defaulted from preset interval, editable), document (certificate). Next-due generates a reminder and a task with origin `pet_appointment`. |
| CAT-004 | M | **Medications**: name, form, strength, dose, route, frequency (RRULE or per-day slots), start/end date or ongoing, prescribing vet, pharmacy, refill quantity and refills remaining, linked product (FOOD/STOR stock) for on-hand quantity, instructions (with food, etc.). Each scheduled dose is a task instance (origin `pet_medication`) that is checked off with time and administering member; missed doses are flagged. Refill reminders trigger from remaining count or projected run-out. |
| CAT-005 | M | **Preventives** (flea/tick, deworming) modelled as medications with a monthly/quarterly schedule and product link. |
| CAT-006 | M | **Vet visits**: date, provider, reason, notes, diagnosis, weight taken, procedures, prescriptions issued (creating medication records), follow-up date (task), cost (transaction, BUD), documents (invoice, discharge notes, lab results). |
| CAT-007 | M | **Weight tracking**: dated entries with unit; chart over time with optional target range; weight captured in vet visits auto-enters the series. Rapid weight change (> configurable % over 30 days) surfaces a warning. |
| CAT-008 | M | **Symptom / observation journal**: dated free-text entries with structured tags (vomiting, lethargy, appetite change, litter change, limping, …), severity, and photo. Entries can be linked to a vet visit later. A journal timeline view supports "what was happening in the two weeks before the visit". |
| CAT-009 | M | **Conditions**: ongoing diagnoses (CKD, hyperthyroidism, diabetes, dental disease) with onset date, status, notes, linked medications and monitoring plans (e.g. quarterly bloodwork as a MAINT-style recurring plan against the pet). |
| CAT-010 | M | **Care plan / care sheet**: a single page per pet summarising feeding (what, how much, when), current medications and dose times, litter routine, quirks, vet and emergency vet contacts, insurance details, and a printable/PDF version. Shareable with a Limited-role user (AUTH-010) for pet-sitting. |
| CAT-011 | M | **Diet**: feeding schedule entries (time, product, amount, unit); products link to pantry stock (FOOD-016) to project run-out and drive the shopping list; diet change history retained (important for conditions). |
| CAT-012 | S | **Litter and supplies**: litter products and other pet consumables tracked as non-food stock (FOOD-023) with par levels; litter-box cleaning as a recurring task template. |
| CAT-013 | M | **Costs**: every vet visit, medication purchase, food purchase, insurance premium and supply attributed to the pet via BUD attributions; a per-pet cost summary (monthly/yearly, by category) and lifetime total. |
| CAT-014 | S | **Insurance**: policy number, insurer (CONT), premium (recurring bill), deductible, coverage notes, claim log (date, visit, amount claimed, amount reimbursed as income transaction). |
| CAT-015 | S | **Documents**: adoption papers, microchip registration, vaccination certificates, lab results, imaging (DOC), all filterable by pet. |
| CAT-016 | S | **Lab results**: structured entries (test name, value, unit, reference range, date, provider) with trend charts for repeated tests (creatinine, T4, glucose). Import from CSV or manual. |
| CAT-017 | S | **Reminders**: annual check-up, vaccination due, medication dose, refill, preventive due, insurance renewal, microchip registration update, all through the task engine with per-pet notification preferences. |
| CAT-018 | C | **Emergency card**: a one-screen mobile view with photo, microchip, vet numbers, current meds and allergies for use at an emergency vet. |
| CAT-019 | C | Multi-pet medication dispensing view: "tonight's doses" across all pets as a single checklist. |
| CAT-020 | S | **Deceased/rehomed** handling: mark status with date, stop all reminders, retain history, exclude from active views, keep in cost reports. |
| CAT-021 | W | Dog and other species presets (schema already supports it). |

---

## 16. Module: Contacts and Vendors

| ID | Pri | Requirement |
|---|---|---|
| CONT-001 | M | The system shall maintain contacts with name, type (`contractor`, `vendor/store`, `vet`, `service_provider`, `person`, `insurer`, `utility`, `authority`), phone(s), email, website, address, notes, tags, documents, and ratings (1–5 with comment). |
| CONT-002 | M | Contacts shall be linkable as: vendor on transactions, performer on maintenance records, provider on pet records, supplier on materials/products, counterparty on loans, quote issuer on projects. |
| CONT-003 | M | A contact page shall show all linked history (jobs done, spend total, quotes, loans) so that "who did the plumbing last time and were they good?" is one click. |
| CONT-004 | S | Vendor **specialties** (plumbing, electrical, HVAC, roofing…) and a "preferred" flag; project quote requests can filter by specialty. |
| CONT-005 | S | Utility and service accounts (electricity, gas, water, internet) with account number (encrypted at rest), provider contact, billing schedule (BUD-007 link), and outage/emergency numbers. |
| CONT-006 | C | vCard import/export. |

---

## 17. Module: Documents and Attachments

| ID | Pri | Requirement |
|---|---|---|
| DOC-001 | M | Any entity shall accept file attachments: images (JPEG, PNG, HEIC→JPEG conversion server-side, WebP), PDF, common office documents, text, and arbitrary files up to an admin-configurable size (default 50 MB). |
| DOC-002 | M | Images shall be stored with generated thumbnails and a web-sized derivative; EXIF orientation honoured; EXIF GPS stripped on upload by default (configurable). |
| DOC-003 | M | A **document library** view shall list all attachments with type filters, entity filters, full-text search on filename/title/description/tags, and a "document type" classification (`manual`, `receipt`, `warranty`, `invoice`, `quote`, `contract`, `permit`, `certificate`, `photo`, `plan`, `lab_result`, `other`). |
| DOC-004 | M | One file shall be linkable to multiple entities (a receipt linked to a transaction, an asset and a project). |
| DOC-005 | M | Files shall be stored on a local filesystem volume with content-addressed naming (SHA-256) to deduplicate identical uploads; metadata in the database. |
| DOC-006 | S | Mobile **camera capture** directly into an attachment with client-side downscaling to a configurable max dimension. |
| DOC-007 | S | PDF and image inline preview; other types download. |
| DOC-008 | C | Optional OCR (Tesseract) of images/PDFs to populate searchable text, behind an admin toggle. Hook point for future receipt parsing. |
| DOC-009 | S | S3-compatible object storage as an alternative backend, configured via environment variables. |
| DOC-010 | M | Attachment access shall be authorised through the owning entity's permissions; direct file URLs shall be signed and short-lived or session-authenticated. |

---

## 18. Module: Dashboard, Notifications and Reminders

### 18.1 Dashboard

| ID | Pri | Requirement |
|---|---|---|
| DASH-001 | M | A **Today** dashboard shall be the default landing page, composed of widgets: overdue and due-today tasks (all origins), upcoming 7 days, expiring food, low-stock products, active projects status, budget month status, upcoming bills, pet doses due today, warranty expiries, items/tools on loan, recent activity. |
| DASH-002 | M | Widgets shall be reorderable and hideable per user; the layout shall persist. |
| DASH-003 | S | Each widget shall support quick actions inline (check off task, snooze, mark dose given, add to list) without navigating away. |
| DASH-004 | S | A **weekly review** page shall summarise the past week (completed, spent, wasted food, new items) and the coming week, suitable for a Sunday planning session. |
| DASH-005 | C | Widgets for a wall-mounted tablet/kiosk mode: large text, auto-refresh, limited-role kiosk login. |

### 18.2 Notifications

| ID | Pri | Requirement |
|---|---|---|
| DASH-010 | M | The system shall generate notifications for: task due/overdue, maintenance due, bill due, pet dose due/missed, vaccination due, expiring food, low stock, warranty expiring, budget threshold, project budget threshold, loan return due, invite accepted, mention in a comment. |
| DASH-011 | M | Channels: **in-app** (bell + inbox with read state) and **email** (SMTP) are Must. **Web Push** (PWA push via VAPID, no third-party service beyond the browser vendor's push endpoint) is Should. **ntfy**, **Gotify**, **generic webhook** (JSON POST) and **Apprise-style URL** are Should. Telegram/Discord/Matrix via webhook are Could. |
| DASH-012 | M | Per-user notification preferences: per event type, choose channels and timing (immediate, daily digest at HH:MM, weekly digest); global quiet hours. |
| DASH-013 | M | Reminder delivery shall be **exactly-once** per (event, user, channel) with persistent delivery records, retries with backoff on channel failure, and a visible delivery log for admins. |
| DASH-014 | M | Reminders shall be computed by a server-side scheduler that survives restarts (no lost reminders across container restarts; on start, catch up missed windows and send at most one consolidated "missed while offline" notification per user). |
| DASH-015 | S | Per-entity reminder overrides: on any dated item, set custom lead times (e.g. remind 2 weeks and 2 days before). |
| DASH-016 | S | Notification actions: emails/pushes shall deep-link to the item; push notifications shall support "mark done" / "snooze" actions where the platform allows. |
| DASH-017 | C | "Nag" escalation: an overdue medication dose re-notifies at a configurable interval until marked given or skipped. |

---

## 19. Module Integration Matrix

This is the heart of the product. Each cell describes the concrete link; `M/S/C` is the priority of that link.

| From ↓ / To → | Tasks | Assets/Locations | Maintenance | Projects | Budget | Food/Pantry | Storage | Tools | Cats | Contacts | Documents |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Tasks** | — | Task can reference a location/asset (S) | Task instance is the due-work unit (M) | Project tasks (M) | Bill tasks (M) | Shopping tasks (S) | Loan-return tasks (S) | Loan-return tasks (M) | Dose and appointment tasks (M) | Assignee may be a vendor (S) | Attachments (M) |
| **Assets** | | — | Plans and history per asset (M) | Project creates/updates assets on completion (S) | Purchase, repair and TCO (M) | Consumable specs → products (S) | Assets located in tree; shared tree (M) | Tools are assets (M) | — | Purchase vendor, installer (M) | Manuals, warranties, receipts (M) |
| **Maintenance** | | | — | Plan can be "adopted" into a project (C) | Completion cost → transaction (M) | Consumables used → stock decrement (M) | Parts from storage (S) | Required tools, tool maintenance (M) | Pet monitoring plans reuse recurring engine (M) | Vendor-performed work (S) | Service invoices (M) |
| **Projects** | | | | — | Project budget, actuals, committed (M) | Materials that are consumables (S) | Leftovers filed to storage (S) | Tools needed, checkout (M) | — | Quotes, contractors (M) | Plans, permits, photos (M) |
| **Budget** | | | | | — | Grocery trips and price history (M) | Sale proceeds on disposal (S) | Tool purchases (M) | Per-pet costs (M) | Payees (M) | Receipts (M) |
| **Food/Pantry** | | | | | | — | Food areas are storage locations (M) | Tool consumables use the product catalogue (M) | Pet food and meds as stock; run-out projection (M) | Preferred stores (S) | Product images (S) |
| **Storage** | | | | | | | — | Tools live in the tree; labels shared (M) | Pet supplies (S) | Loans to people (S) | Item photos (M) |
| **Tools** | | | | | | | | — | — | Loans, repair shops (M) | Manuals (S) |
| **Cats** | | | | | | | | | — | Vets, insurers, sitters (M) | Certificates, lab results (S) |
| **Contacts** | | | | | | | | | | — | Contracts, quotes (S) |

### 19.1 Integration requirements

| ID | Pri | Requirement |
|---|---|---|
| INT-001 | M | A single polymorphic **entity reference** mechanism shall be used for all cross-module links (`entity_type`, `entity_id`), with server-side validation of allowed target types per relationship. |
| INT-002 | M | Cross-module side effects (e.g. completing a maintenance task decrements stock) shall be implemented as **domain events** handled synchronously within the same transaction where consistency matters (stock, money) and asynchronously where not (notifications, search indexing). |
| INT-003 | M | Every entity page shall have a **"Related"** panel listing linked entities grouped by type, with the ability to add links inline. |
| INT-004 | M | Deleting an entity that is referenced shall be prevented or converted to archive/retire, never cascade-deleting financial or historical records. |
| INT-005 | S | A **"what does this cost?"** computation shall be available on assets, projects, pets, tools and locations, summing directly attributed transactions plus (optionally) transactions attributed to child entities. |
| INT-006 | S | A **"what do I need?"** computation shall be available on maintenance plans and projects: required tools (owned/available?), required consumables (in stock?), producing a shopping list and a tool wishlist in one action. |

---

## 20. Data Model

This section lists entities, key fields and relationships. Types: `id` = ULID/UUID; `ts` = UTC timestamp; `date` = calendar date; `money` = integer minor units + currency; `json` = structured JSON.

### 20.1 Platform

| Entity | Key fields |
|---|---|
| `household` | id, name, timezone, currency, unit_system, settings(json) |
| `user` | id, household_id, email, username, display_name, password_hash, role, avatar_file_id, is_active, totp_secret(enc), prefs(json) |
| `invite` | id, token_hash, role, expires_at, used_by_user_id |
| `api_token` | id, user_id, name, token_hash, scope, last_used_at, expires_at |
| `session` | id, user_id, expires_at, ip, user_agent |
| `tag` | id, name, colour, description |
| `entity_tag` | tag_id, entity_type, entity_id |
| `entity_link` | id, from_type, from_id, to_type, to_id, relation, created_by |
| `comment` | id, entity_type, entity_id, user_id, body_md, parent_comment_id |
| `custom_field_def` | id, entity_type, name, field_type, options(json), required, sort |
| `custom_field_value` | field_def_id, entity_type, entity_id, value(json) |
| `activity_log` | id, ts, user_id, action, entity_type, entity_id, diff(json) |
| `notification` | id, user_id, event_type, entity_type, entity_id, title, body, created_at, read_at |
| `notification_delivery` | id, notification_id, channel, status, attempts, last_error, delivered_at |
| `notification_pref` | user_id, event_type, channels(json), timing, lead_times(json) |
| `saved_view` | id, user_id, list_key, name, filters(json), shared |
| `file` | id, sha256, size, mime, original_name, width, height, storage_key, created_by |
| `attachment` | id, file_id, entity_type, entity_id, doc_type, title, description, sort |
| `label_code` | id, code, entity_type, entity_id, assigned_at |

### 20.2 Tasks

| Entity | Key fields |
|---|---|
| `task` | id, title, description_md, status, priority, due_at/due_date, start_date, parent_task_id, origin_type, origin_id, schedule_id, property_id, estimate_min, actual_min, completed_at, completed_by, completion_note, visibility, sort_key |
| `task_assignee` | task_id, user_id |
| `task_dependency` | task_id, blocked_by_task_id |
| `checklist_item` | id, task_id, text, done, sort |
| `checklist_template` | id, name, items(json) |
| `schedule` | id, rrule, mode(fixed/floating/on_demand/one_off), anchor_date, horizon_days, next_due, last_completed_at, template(json: title, description, assignees, checklist, estimate, priority), origin_type, origin_id, active |
| `board` | id, name, property_id, filter(json), owner_user_id, shared |
| `lane` | id, board_id, name, status_mapping, wip_limit, sort |
| `board_task` | board_id, lane_id, task_id, sort |
| `automation_rule` | id, board_id, trigger(json), action(json), active |
| `time_entry` | id, task_id, user_id, started_at, ended_at, minutes, note |

### 20.3 Registry

| Entity | Key fields |
|---|---|
| `property` | id, name, type, address(json), purchase_date, purchase_price, sqft, year_built, lot_size, notes_md, profile(json) |
| `location` | id, property_id, parent_id, name, type, short_code, description, photo_file_id, holds_food, temperature_class, dimensions(json), path_cache |
| `asset_category` | id, parent_id, name, default_lifespan_years, icon |
| `asset` | id, property_id, location_id, category_id, kind(asset/tool), name, make, model, serial, purchase_date, purchase_price, purchase_vendor_id, purchase_transaction_id, installed_date, warranty_expiry, expected_lifespan_years, condition, status, replacement_cost_estimate, retired_at, disposal(json), replaced_by_asset_id, notes_md |
| `asset_component` | id, asset_id, name, spec(json), product_id |
| `warranty` | id, asset_id, provider_contact_id, type, start_date, end_date, coverage_md, cost_transaction_id |
| `reading` | id, asset_id, metric, value, unit, taken_at, note |

### 20.4 Maintenance

| Entity | Key fields |
|---|---|
| `maintenance_plan` | id, target_type(asset/location/property/pet), target_id, title, description_md, schedule_id, estimate_min, estimate_cost, priority, diy, vendor_contact_id, checklist_template_id, season_tags, grace_days, reading_trigger(json), active |
| `maintenance_required_tool` | plan_id, asset_id(tool) |
| `maintenance_required_consumable` | plan_id, product_id, quantity, unit |
| `maintenance_record` | id, plan_id?, target_type, target_id, task_id?, kind(planned/adhoc/repair), performed_at, performer_user_id, performer_contact_id, cost_transaction_id, notes_md, failure_description, cause |
| `maintenance_consumption` | record_id, product_id, stock_item_id, quantity |
| `maintenance_template` | id, category_id, title, rrule, mode, description_md, checklist(json), consumables(json), tools(json) |

### 20.5 Projects

| Entity | Key fields |
|---|---|
| `project` | id, property_id, name, description_md, status, owner_user_id, priority, target_start, target_end, actual_start, actual_end, budget_amount, budget_breakdown(json), cover_file_id, template_id, retrospective(json) |
| `project_location` | project_id, location_id |
| `project_phase` | id, project_id, name, sort, target_start, target_end, status |
| `project_phase_dependency` | phase_id, depends_on_phase_id |
| `project_material` | id, project_id, phase_id?, product_id?, description, quantity, unit, est_unit_cost, actual_cost, status, supplier_contact_id, transaction_id, storage_item_id |
| `project_tool` | project_id, asset_id(tool), required_from, required_to, checked_out_at, checked_in_at |
| `project_tool_wish` | id, project_id, description, est_cost, rent_or_buy, note |
| `quote` | id, project_id, contact_id, scope, amount, quoted_at, valid_until, status, notes_md, lines(json) |
| `permit` | id, project_id, authority_contact_id, permit_number, fee_transaction_id, applied_at, issued_at, expires_at, status |
| `inspection` | id, permit_id, task_id, scheduled_at, outcome, notes |
| `decision` | id, project_id, decided_at, title, rationale_md, alternatives_md, decided_by |
| `project_template` | id, name, phases(json), tasks(json), materials(json), permits(json) |

### 20.6 Budget

| Entity | Key fields |
|---|---|
| `account` | id, name, type, opening_balance, opening_date, currency, archived |
| `category` | id, parent_id, name, kind(expense/income), archived, rollover_rule |
| `payee` | id, name, contact_id, default_category_id |
| `transaction` | id, date, amount, currency, fx_rate, type, account_id, transfer_account_id, payee_id, memo, cleared, paid_by_user_id, shared, import_hash, recurring_bill_id |
| `transaction_split` | id, transaction_id, amount, category_id, memo |
| `transaction_attribution` | id, split_id, entity_type, entity_id |
| `transaction_line_item` | id, transaction_id, product_id, description, quantity, unit_price |
| `budget_period` | id, year, month?, custom_start?, custom_end? |
| `budget_allocation` | period_id, category_id, amount |
| `recurring_bill` | id, payee_id, category_id, account_id, amount, variable, schedule_id, lead_days, active |
| `goal` | id, name, target_amount, target_date, account_id, status |
| `goal_contribution` | goal_id, transaction_id |
| `import_profile` | id, name, mapping(json) |

### 20.7 Food and consumables

| Entity | Key fields |
|---|---|
| `product_category` | id, parent_id, name |
| `product` | id, name, brand, category_id, is_food, is_pet_supply, default_unit, package_size, package_unit, shelf_life(json by temp class), use_within_days_opened, min_quantity, auto_shopping, image_file_id, nutrition(json), notes |
| `product_barcode` | product_id, barcode, symbology |
| `stock_item` | id, product_id, location_id, quantity, unit, expiry_date, opened_at, purchased_at, transaction_id, note |
| `stock_movement` | id, stock_item_id, delta, reason(add/consume/waste/adjust/audit), user_id, ts, ref_type, ref_id |
| `shopping_list` | id, name, default, store_contact_id |
| `shopping_line` | id, list_id, product_id?, text, quantity, unit, note, store_contact_id, checked_at, source_type, source_id |
| `recipe` | id, name, servings, prep_min, cook_min, steps_md, source_url, image_file_id |
| `recipe_ingredient` | recipe_id, product_id?, text, quantity, unit |
| `meal_plan_entry` | id, date, slot, recipe_id?, text |
| `waste_log` | id, stock_item_id, quantity, reason, ts, est_cost |

### 20.8 Storage and tools

| Entity | Key fields |
|---|---|
| `storage_category` | id, parent_id, name |
| `storage_item` | id, location_id, category_id, name, description, quantity, est_value, purchase_date, purchase_price, condition, review_by, project_id?, status(stored/loaned/borrowed/disposed) |
| `loan` | id, item_type(storage_item/asset), item_id, direction(out/in), contact_id, lent_at, due_back, returned_at, return_condition, task_id |
| `tool_profile` | asset_id, tool_type, power_source, battery_platform_id, accessories(json) |
| `battery_platform` | id, name, voltage, brand |
| `battery` | id, platform_id, asset_id?, capacity_ah, health, purchased_at |
| `tool_consumable_spec` | id, asset_id, description, spec(json) |
| `tool_consumable_product` | spec_id, product_id |
| `tool_kit` | id, name; `tool_kit_member` (kit_id, asset_id) |
| `tool_usage` | id, asset_id, project_id?, task_id?, ts, hours, note |

### 20.9 Pets

| Entity | Key fields |
|---|---|
| `species_profile` | id, code, labels(json), vaccine_presets(json), weight_ranges(json) |
| `pet` | id, name, species_code, breed, sex, neutered, dob, microchip, markings, status, status_date, primary_vet_contact_id, emergency_vet_contact_id, notes_md |
| `pet_vaccination` | id, pet_id, vaccine, given_at, provider_contact_id, lot, next_due, task_id |
| `pet_medication` | id, pet_id, name, form, strength, dose, route, schedule_id, start_date, end_date, ongoing, vet_contact_id, pharmacy_contact_id, product_id, refills_remaining, refill_qty, instructions_md, active |
| `pet_dose` | id, medication_id, task_id, due_at, given_at, given_by, status(given/missed/skipped), note |
| `pet_visit` | id, pet_id, visited_at, provider_contact_id, reason, notes_md, diagnosis, follow_up_task_id, cost_transaction_id |
| `pet_weight` | id, pet_id, taken_at, weight, unit, source(manual/visit) |
| `pet_journal` | id, pet_id, ts, body_md, tags(json), severity, visit_id? |
| `pet_condition` | id, pet_id, name, onset_date, status, notes_md |
| `pet_lab_result` | id, pet_id, visit_id?, test, value, unit, ref_low, ref_high, taken_at |
| `pet_diet_entry` | id, pet_id, time_of_day, product_id, amount, unit, active_from, active_to |
| `pet_insurance` | id, pet_id, insurer_contact_id, policy_number, premium_bill_id, deductible, notes_md |
| `pet_claim` | id, insurance_id, visit_id, claimed_amount, reimbursed_transaction_id, status |

### 20.10 Contacts

| Entity | Key fields |
|---|---|
| `contact` | id, name, type, phones(json), email, website, address(json), notes_md, rating, preferred, specialties(json) |
| `service_account` | id, contact_id, kind, account_number(enc), emergency_phone, recurring_bill_id |

### 20.11 Referential rules

- All foreign keys `ON DELETE RESTRICT` except join tables and child rows owned by the parent (`ON DELETE CASCADE`).
- `entity_type` discriminators are validated by an application-level registry; the registry is the single source of truth for which types may link to which.
- Soft delete is implemented by `deleted_at`; unique constraints include a generated column so that deleted rows do not block re-creation.

---

## 21. API Requirements

| ID | Pri | Requirement |
|---|---|---|
| API-001 | M | The server shall expose a versioned **REST/JSON API** under `/api/v1` that the web UI itself uses (no private UI-only endpoints). |
| API-002 | M | The API shall be documented with an **OpenAPI 3.1** specification served at `/api/v1/openapi.json` with an interactive explorer. |
| API-003 | M | Authentication: session cookie (browser) or `Authorization: Bearer <api_token>` (AUTH-009). |
| API-004 | M | List endpoints shall support pagination (cursor-based), filtering, sorting and sparse field selection consistently. |
| API-005 | M | Mutations shall use optimistic concurrency via an `updated_at`/version check with `409 Conflict` on stale writes. |
| API-006 | M | Errors shall follow RFC 9457 Problem Details. |
| API-007 | S | **Webhooks**: admins may register outbound webhooks for domain events (task.completed, stock.low, transaction.created, …) with HMAC signatures and delivery logs. |
| API-008 | S | **Server-Sent Events** endpoint for live updates (shopping list, board changes, notifications). |
| API-009 | S | Convenience "capture" endpoints for automation (Home Assistant, Shortcuts, NFC tags): `POST /api/v1/capture/task`, `/capture/transaction`, `/capture/stock` with minimal payloads. |
| API-010 | C | Home Assistant integration surface: read-only sensors (tasks due today, expiring food count, pet dose due) via the REST API, documented with example configuration. |

---

## 22. User Experience Requirements

| ID | Pri | Requirement |
|---|---|---|
| UX-001 | M | Responsive layout: a mobile-first navigation (bottom tab bar: Today, Tasks, Scan, Search, More) and a desktop layout (left sidebar with modules, wide tables). |
| UX-002 | M | **PWA**: installable, app icon, offline shell; read-only offline access to the last-loaded shopping list, pet care sheets, and today's tasks; queued writes for shopping check-off and task completion that sync on reconnect (Should for queued writes). |
| UX-003 | M | **Scan** is a first-class action: a camera view that reads EAN/UPC (pantry) and QR (labels) and routes to the right flow. |
| UX-004 | M | Global keyboard shortcuts on desktop: quick add (`n`), search (`/`), go to Today (`g t`), etc. A command palette (`Ctrl/Cmd+K`) listing actions and entities. |
| UX-005 | M | Dark and light themes following OS preference with manual override. |
| UX-006 | M | Accessibility: WCAG 2.1 AA targets; full keyboard operability; visible focus; ARIA labelling on drag-and-drop with keyboard alternatives; colour never the sole carrier of meaning. |
| UX-007 | M | List views shall render 1,000+ rows smoothly (virtualisation) and support column sort, filter chips, saved views (GEN-014), and CSV export. |
| UX-008 | M | Forms shall autosave drafts locally and warn on navigation with unsaved changes. |
| UX-009 | S | Inline editing on detail pages (click-to-edit fields) rather than separate edit screens for simple fields. |
| UX-010 | S | Empty states shall teach: each module's first-run screen explains the concept and offers seed templates (default categories, maintenance library, sample board). |
| UX-011 | S | A guided **onboarding wizard**: household name/timezone/currency → first property → rooms (from a checklist) → key systems (HVAC, water heater, roof…) with year installed → members → done. Instantiating the maintenance library for the chosen systems is offered at the end. |
| UX-012 | C | Printable views: care sheet, project brief, insurance inventory, label sheets, weekly plan. |
| UX-013 | M | Destructive actions require confirmation and support undo (GEN-019). |
| UX-014 | S | Number and date inputs respect household locale for formatting; unit inputs allow typing "16x25x1 in" or "2.5 kg". |

---

## 23. Non-Functional Requirements

| ID | Pri | Requirement |
|---|---|---|
| NFR-001 | M | **Performance**: p95 API latency under 200 ms for list/detail endpoints at a dataset of 50k tasks, 20k transactions, 5k stock items, 5k storage items, 10k attachments on a 2-vCPU/2 GB host (typical NAS or mini-PC). |
| NFR-002 | M | **Startup**: container ready in under 10 seconds on the reference host; migrations run automatically on start. |
| NFR-003 | M | **Footprint**: idle memory under 300 MB; image size under 300 MB. |
| NFR-004 | M | **Reliability**: no data loss on power failure (database in WAL mode with synchronous commits for financial writes; uploads written then linked). |
| NFR-005 | M | **Scheduler correctness**: reminders due during downtime are delivered on restart; no duplicates (DASH-013/014). Verified by an automated test that simulates downtime. |
| NFR-006 | M | **Concurrency**: at least 10 simultaneous household users without degradation. |
| NFR-007 | M | **Data integrity**: money and stock changes are transactional; a failed side effect rolls back the primary write. |
| NFR-008 | M | **Portability**: runs on linux/amd64 and linux/arm64 (Raspberry Pi 4/5, Apple-silicon Docker). |
| NFR-009 | M | **Observability**: structured JSON logs with request IDs; `/healthz` and `/readyz`; optional Prometheus `/metrics`. |
| NFR-010 | S | **Upgradability**: forward-only migrations; every release documents breaking changes; a pre-upgrade automatic backup is taken. |
| NFR-011 | M | **Testability**: unit tests for domain logic (recurrence, budgeting math, stock math), integration tests for API, E2E smoke tests for critical flows (see section 28). |
| NFR-012 | S | **Maintainability**: modular monolith with module boundaries enforced by lint rules; a CONTRIBUTING guide; ADRs for major decisions. |
| NFR-013 | M | **Licensing**: all dependencies OSI-approved and compatible with the project's chosen licence (recommend AGPL-3.0 or MIT; decision in section 30). |

---

## 24. Self-Hosting, Deployment and Operations

| ID | Pri | Requirement |
|---|---|---|
| OPS-001 | M | Distribution as a **single OCI container image** (multi-arch) containing the server and built web assets, published to GHCR with semver tags and `latest`. |
| OPS-002 | M | A reference `docker-compose.yml` with one service, two volumes (`data` for the database, `files` for uploads), and documented environment variables. |
| OPS-003 | M | **SQLite** (WAL mode) as the default database with zero configuration. **PostgreSQL** as an optional backend via `DATABASE_URL` (Should). Both must pass the same test suite. |
| OPS-004 | M | All configuration via environment variables with sane defaults, plus an admin settings UI for household-level settings (stored in DB). Secrets (SMTP password, OIDC secret) via env or Docker secrets files (`*_FILE` convention). |
| OPS-005 | M | Serve HTTP on a single port; TLS is expected to be terminated by a reverse proxy (Caddy, Traefik, nginx). Documented examples for each. Correct handling of `X-Forwarded-*` headers behind a trusted proxy. |
| OPS-006 | M | Work correctly when served under a sub-path (`https://home.example.com/homestead/`) via a `BASE_PATH` setting. |
| OPS-010 | M | **Backups**: an admin action and a CLI subcommand (`homestead backup`) produce a single archive containing a consistent database snapshot (SQLite online backup API / `pg_dump`) plus the files directory (or a manifest referencing S3 objects). Scheduled automatic backups to a local path with retention (daily×7, weekly×4, monthly×12) are Must. |
| OPS-011 | M | **Restore**: `homestead restore <archive>` restores a backup into an empty data directory; documented and tested in CI. |
| OPS-012 | S | Optional backup upload to S3-compatible storage or a WebDAV target. |
| OPS-020 | M | **Full export**: a ZIP containing every table as CSV and as JSON Lines, plus all files, plus a `schema.json`; runnable by any Member. **Full import** from that ZIP into a fresh install (Admin). |
| OPS-021 | S | **Per-module CSV imports** with mapping UIs: transactions (BUD-008), products, stock, storage items, assets, contacts, tools, maintenance history. |
| OPS-022 | S | Importers for common sources: Grocy (products/stock/chores), HomeBox (items/locations), YNAB/Actual CSV (transactions). Each is a best-effort mapping documented in the manual. |
| OPS-030 | M | An **admin console** showing: version, database size, file storage size, scheduler status and last run, notification delivery failures, background job queue, active sessions, and update availability check (opt-in, GitHub releases). |
| OPS-031 | M | A **demo/seed mode** (`HOMESTEAD_DEMO=1`) that populates a fresh install with realistic sample data (a house, rooms, assets, a project, transactions, pantry, a cat) for evaluation and for screenshots. |
| OPS-032 | S | A CLI for admin tasks: create user, reset password, promote to admin, run migrations, backup, restore, export, import, reindex search. |
| OPS-033 | M | Documentation site (Markdown in repo, rendered): install, configure, reverse proxy, backup/restore, upgrade, API, module guides, FAQ. |

---

## 25. Security and Privacy

| ID | Pri | Requirement |
|---|---|---|
| SEC-001 | M | All endpoints require authentication except login, invite acceptance, health checks, and public static assets. |
| SEC-002 | M | CSRF protection for cookie-authenticated mutations (SameSite + origin check + token for non-JSON forms). |
| SEC-003 | M | Content Security Policy that forbids inline scripts and third-party origins; no external CDN dependencies at runtime. |
| SEC-004 | M | Uploaded files served with `Content-Disposition` and `X-Content-Type-Options: nosniff`; SVG uploads sanitised or served as downloads; image processing in a sandboxed library with size limits to mitigate decompression bombs. |
| SEC-005 | M | Sensitive fields (utility account numbers, TOTP secrets, OIDC client secret, SMTP password if stored in DB) encrypted at rest with a server-side key from `HOMESTEAD_SECRET_KEY`; key rotation procedure documented. |
| SEC-006 | M | Input validation on every endpoint with schema-based validation; database access via parameterised queries only. |
| SEC-007 | M | Dependency vulnerability scanning in CI; container image scanning; a documented security policy and disclosure contact. |
| SEC-008 | S | Per-user audit visibility: users can see their own sessions and revoke them. |
| SEC-009 | M | No telemetry, no phone-home, no analytics. Update checks are opt-in and send only the version string. |
| SEC-010 | S | Rate limiting on authentication, capture endpoints, and file uploads. |
| SEC-011 | M | The default configuration shall be secure out of the box: admin created interactively, no default password, cookie flags set, demo mode off. |

---

## 26. Recommended Technical Architecture

This section is a recommendation, not a requirement, to make implementation estimates concrete. The existing repository is a Create React App project (React 17, `react-beautiful-dnd`, `react-hook-form`) with no backend. Both CRA and `react-beautiful-dnd` are unmaintained; the recommendation is to **retire the CRA scaffold and rebuild** while reusing the board concepts and demo data shapes.

### 26.1 Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript end to end | One language, shared validation schemas between client and server. |
| Server | Node 22 + **Fastify** | Fast, plugin architecture, first-class OpenAPI via schema, small footprint. |
| Validation | **Zod** schemas shared with the client; generated OpenAPI | Single source of truth for types, validation and docs. |
| ORM / migrations | **Drizzle ORM** with SQLite (better-sqlite3) and PostgreSQL drivers | Typed SQL, supports both targets, plain SQL migrations committed to the repo. |
| Background jobs | In-process scheduler with a DB-backed job table (no Redis) | Meets single-container principle; job rows give exactly-once semantics. |
| Search | SQLite FTS5 / Postgres `tsvector` | No external search service. |
| Files | Local disk (content-addressed), optional S3 via `@aws-sdk/client-s3`; `sharp` for images | Standard, well maintained. |
| Auth | Local (Argon2id) + optional OIDC (`openid-client`) + trusted header; `@fastify/secure-session` cookies | Covers home-lab norms (Authelia/Authentik). |
| Notifications | Nodemailer (SMTP), `web-push` (VAPID), HTTP for ntfy/Gotify/webhooks | All self-hostable. |
| Barcode/QR | `@zxing/browser` or the native `BarcodeDetector` API when present; `qrcode` for generation | Runs in-browser, no native app. |
| Recurrence | `rrule` library with custom floating-mode wrapper | RFC 5545 compliance. |
| Web client | **React 18 + Vite + TypeScript**, TanStack Router/Query/Table, `@dnd-kit` for drag-and-drop, `react-hook-form` + Zod, Tailwind CSS with a small component layer (e.g. shadcn-style), Recharts for charts | Modern replacements for the CRA/RBD stack; `react-hook-form` already used in the prototype. |
| PWA | Vite PWA plugin, Workbox | Offline shell, push. |
| Tests | Vitest (unit/integration), Playwright (E2E) | Playwright is pre-installed in the target dev environment. |
| Packaging | Single Dockerfile (multi-stage), `docker compose` reference, GHCR multi-arch build via GitHub Actions | OPS-001/002. |

### 26.2 Repository layout (proposed monorepo)

```
/apps
  /server        Fastify app, modules under /src/modules/<module>
  /web           Vite React app, feature folders mirroring server modules
/packages
  /schemas       Zod schemas + TS types shared by server and web
  /recurrence    RRULE + fixed/floating scheduling logic (pure, heavily unit-tested)
  /money         Integer money math, currency formatting
  /units         Unit parsing and conversion
/docs            Requirements (this file), ADRs, user manual
/deploy          Dockerfile, docker-compose.yml, reverse-proxy examples
```

### 26.3 Module structure (server)

Each module exposes: `routes.ts` (HTTP), `service.ts` (domain logic), `repo.ts` (data access), `events.ts` (published/handled domain events), `schema.ts` (Drizzle tables), and `seeds.ts` (default data). Cross-module calls go through the service layer or events only; a lint rule forbids importing another module's `repo`.

---

## 27. Delivery Plan and Milestones

Each milestone is independently useful and shippable. Priorities marked M in a module are required for that module's milestone; S items are included where the milestone note says so.

| Milestone | Contents | Exit criteria |
|---|---|---|
| **M0 — Foundation** | Monorepo, server skeleton, DB + migrations (SQLite), auth (local), roles, household/property/location tree, tags, links, attachments, activity log, global search, notifications (in-app + email), scheduler, Docker image, backup/restore, export, docs skeleton, onboarding wizard. | Fresh install to first task in under 5 minutes; backup/restore round-trip test passes. |
| **M1 — Tasks and Maintenance** | Task engine (recurrence fixed/floating, boards, calendar, Today), asset registry, maintenance plans/records/templates library, warranties, readings (S). | Existing TaskBoard demo data migrates into boards; furnace-filter floating schedule works across three completions; maintenance library instantiates for a category. |
| **M2 — Budget** | Transactions, splits, attributions, categories, monthly budgets, recurring bills, CSV import, reports, dashboard widget, shared "attach cost" component wired into maintenance. | Import 12 months of bank CSV with dedupe; monthly report matches a hand-computed spreadsheet; maintenance completion creates a correctly attributed transaction. |
| **M3 — Food, Storage, Labels** | Product catalogue, stock, scanning, expiry, par levels, shopping lists (live), put-away, price history (S), waste log (S), storage items, container views, labels/QR, loans (S). | Restock session of 20 scanned items in under 3 minutes on a phone; "where is X" finds a labelled bin; expiring-food digest arrives. |
| **M4 — Tools and Projects** | Tool profiles, battery platforms, consumable specs, loans, kits (S); projects with phases, tasks, materials, tools-needed, budget rollup, quotes, photos, permits (S), decisions (S), templates (S), Gantt (S). | A sample bathroom remodel template runs end to end with budget actuals from transactions and tool checkout. |
| **M5 — Cat Health** | Pet profiles, vaccinations, medications with dose tasks, preventives, visits, weight, journal, conditions, care sheet with Limited-role sharing, diet with pantry run-out, costs, insurance (S), lab results (S). | Twice-daily medication generates dose tasks with push notifications and missed-dose flags; care sheet viewable by a house-sitter account and nothing else. |
| **M6 — Polish and Integrations** | Web push, ntfy/Gotify/webhooks, OIDC, PostgreSQL backend, ICS feeds, SSE live updates, weekly review, long-range planning view, importers (Grocy/HomeBox/YNAB), PWA offline writes, custom fields, saved views, automations. | All S-priority cross-module links in section 19 implemented; performance targets in NFR-001 met on the reference host. |

Estimated relative effort (for credit planning): M0 15%, M1 15%, M2 15%, M3 17%, M4 15%, M5 13%, M6 10%.

---

## 28. Acceptance Criteria and Test Strategy

### 28.1 Test layers

| Layer | Tooling | Coverage expectation |
|---|---|---|
| Unit | Vitest | Recurrence engine (fixed vs floating, DST boundaries, month-end rules), money math and splits, unit conversion, stock arithmetic, budget rollover, dedupe hashing, permission checks. Target ≥ 90% on `/packages/*`. |
| Integration (API) | Vitest + in-memory SQLite and a Postgres service in CI | Every endpoint: auth, validation, happy path, permission denial, concurrency conflict. Cross-module side effects verified transactionally. |
| Scheduler | Vitest with fake timers | Reminders across restart, no duplicates, quiet hours, digests. |
| E2E | Playwright (desktop and mobile viewport) | Critical journeys in Appendix C, plus onboarding, backup/restore, export/import, PWA install and offline read. |
| Migration | CI job | Apply all migrations to an empty DB and to the previous release's demo DB; run the API suite against both. |
| Performance | k6 or autocannon in CI (nightly) | NFR-001 dataset seeded; p95 assertions. |
| Security | CI | Dependency audit, container scan, CSP header test, upload sanitisation tests. |

### 28.2 Definition of done (per requirement)

A requirement is done when: the behaviour is implemented behind the documented API and UI; unit/integration tests cover it; it is documented in the user manual; it works on SQLite (and Postgres if M6 is reached); and it is demonstrated in demo mode data.

---

## 29. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Scope breadth leads to shallow modules | Users abandon a half-built module | Milestone plan ships modules vertically complete; Must-priorities are minimal by design. |
| Recurrence edge cases (DST, month-end, floating after late completion) | Wrong reminders erode trust (goal G6) | Isolated `recurrence` package with exhaustive tests; snapshot tests of generated dates. |
| Barcode scanning reliability in the browser | Pantry capture too slow | Support native `BarcodeDetector` where present, ZXing fallback, manual entry always available, product search by name. |
| SQLite write contention with many members | Slow saves | WAL mode, short transactions, single writer queue; Postgres as escape hatch. |
| Data model churn during early milestones | Painful migrations for early adopters | Forward-only migrations from M0; demo DB migration test in CI; no schema promises before M2. |
| Unmaintained prototype dependencies (CRA, react-beautiful-dnd) | Security and build breakage | Rebuild on Vite/dnd-kit at M0; reuse concepts only. |
| Attachment storage growth | Backups become large | Content addressing dedupes; image downscaling; S3 option; backup manifest mode. |
| Notification channel failures (SMTP misconfigured) | Silent missed reminders | Delivery log, admin console alerts, in-app inbox always available as a fallback channel. |

---

## 30. Open Questions and Assumptions

| # | Question | Working assumption |
|---|---|---|
| Q1 | Licence for the project? | AGPL-3.0 for the application (keeps modifications open if someone hosts it for others); MIT for shared packages. Owner to confirm. |
| Q2 | Product name? | "Homestead" as a working name; rename before first tagged release. |
| Q3 | Are vehicles in scope for assets/maintenance? | Modelled as an asset category with a `vehicle` location type, but no vehicle-specific features (mileage-based service) until a later cycle. Odometer can use readings (MAINT-009). |
| Q4 | Should budgets support envelope-style "available to assign" (YNAB model) or simple per-category allocation? | Simple allocation with rollover rules (BUD-005). Envelope zero-based mode is Could for a later cycle. |
| Q5 | Do we need per-member private budgets? | No; `paid_by` and `shared` flags only (BUD-032). |
| Q6 | Retain existing repository history and name (`TaskBoard`)? | Yes, keep the repo; the task/board module is the direct descendant. The app is a superset. |
| Q7 | Should the first release include recipes/meal planning? | Recipes are Should (M3 if time permits, otherwise M6); meal planning is Could. |
| Q8 | Which reverse proxy is the "blessed" example? | Caddy, for automatic TLS; Traefik and nginx examples also provided. |
| Q9 | Is Open Food Facts lookup acceptable given the local-by-default principle? | Yes as an opt-in admin toggle, default off, with local caching (FOOD-020). |
| Q10 | Multi-property households: how common? | Rare but real (rental unit, cabin). Supported in the model; UI hides property selectors when there is one property. |

---

## 31. Glossary

| Term | Definition |
|---|---|
| Asset | A durable, trackable item with a lifecycle (appliance, system, fixture, tool). |
| Attribution | The link from a transaction split to the household entity the money was for. |
| Care sheet | The printable summary of a pet's daily care instructions. |
| Container | A location of type bin/box/shelf/drawer that holds items. |
| Fixed schedule | Recurrence anchored to the calendar regardless of completion date. |
| Floating schedule | Recurrence anchored to the last completion date. |
| Lot / stock item | A physical quantity of a product in a specific location with its own expiry. |
| Par level | The minimum quantity of a product that should be on hand. |
| Plan (maintenance) | A definition of recurring or one-off maintenance work that generates tasks. |
| Product | A catalogue entry for a kind of consumable (food or non-food). |
| Property | A building or parcel owned or managed by the household. |
| Reading | A dated numeric measurement against an asset. |
| Split | One line of a transaction with its own amount, category and attribution. |
| Task instance | A concrete task row, possibly generated from a schedule. |

---

## Appendix A: Requirement ID Index

Counts by area and priority (Must / Should / Could / Won't):

| Area | M | S | C | W | Total |
|---|---|---|---|---|---|
| GEN | 14 | 5 | 1 | 0 | 20 |
| AUTH | 8 | 4 | 1 | 0 | 13 |
| TASK | 12 | 5 | 2 | 0 | 19 |
| ASSET | 7 | 4 | 2 | 0 | 13 |
| MAINT | 9 | 5 | 2 | 0 | 16 |
| RENO | 10 | 7 | 2 | 0 | 19 |
| BUD | 11 | 10 | 2 | 0 | 23 |
| FOOD | 13 | 7 | 3 | 0 | 23 |
| STOR | 7 | 6 | 2 | 0 | 15 |
| TOOL | 7 | 5 | 2 | 0 | 14 |
| CAT | 12 | 6 | 2 | 1 | 21 |
| CONT | 3 | 2 | 1 | 0 | 6 |
| DOC | 6 | 3 | 1 | 0 | 10 |
| DASH | 7 | 4 | 2 | 0 | 13 |
| INT | 4 | 2 | 0 | 0 | 6 |
| API | 6 | 3 | 1 | 0 | 10 |
| UX | 9 | 4 | 1 | 0 | 14 |
| NFR | 11 | 2 | 0 | 0 | 13 |
| OPS | 12 | 4 | 0 | 0 | 16 |
| SEC | 9 | 2 | 0 | 0 | 11 |
| **Total** | **177** | **90** | **27** | **1** | **295** |

---

## Appendix B: Seed Data and Defaults

### B.1 Default asset categories

- Appliances: Refrigerator, Freezer, Range/Oven, Cooktop, Range hood, Dishwasher, Microwave, Washer, Dryer, Water softener, Garbage disposal
- HVAC: Furnace, Boiler, Heat pump, Air conditioner (central), Mini-split, Thermostat, Humidifier, Air purifier, Ductwork
- Plumbing: Water heater, Well pump, Pressure tank, Sump pump, Sewage ejector, Septic system, Water filtration, Backflow preventer, Main shutoff
- Electrical: Service panel, Sub-panel, Generator, Transfer switch, EV charger, Solar inverter, Battery storage
- Envelope: Roof, Gutters, Siding, Windows, Exterior doors, Garage door and opener, Deck, Fence, Chimney, Insulation
- Interior: Flooring (by room), Fireplace/stove, Ceiling fans, Smoke/CO detectors, Water leak sensors
- Outdoor: Lawn mower, Snow blower, Irrigation system, Pool/spa equipment, Shed, Outdoor lighting
- Electronics: Network equipment, Server/NAS, TV, Security cameras
- Vehicles (Could): Car, Bicycle, E-bike

### B.2 Default maintenance template library (abbreviated)

| Category | Template | Schedule |
|---|---|---|
| Furnace / Heat pump | Replace air filter | Floating, every 90 days |
| Furnace | Professional tune-up | Fixed, yearly in fall |
| Air conditioner | Clean condenser coils, check refrigerant | Fixed, yearly in spring |
| Water heater (tank) | Flush tank | Fixed, yearly |
| Water heater (tank) | Test T&P valve | Fixed, yearly |
| Water heater (tank) | Inspect anode rod | Fixed, every 3 years |
| Sump pump | Test operation | Fixed, quarterly |
| Water softener | Check salt level | Fixed, monthly (reading-triggered optional) |
| Refrigerator | Clean condenser coils | Fixed, every 6 months |
| Refrigerator | Replace water filter | Floating, every 6 months |
| Dryer | Clean vent duct | Fixed, yearly |
| Dishwasher | Clean filter | Fixed, monthly |
| Range hood | Clean/replace grease filter | Fixed, quarterly |
| Smoke/CO detectors | Test | Fixed, monthly |
| Smoke/CO detectors | Replace batteries | Fixed, yearly |
| Smoke/CO detectors | Replace unit | Fixed, every 10 years |
| Gutters | Clean | Fixed, spring and fall |
| Roof | Visual inspection | Fixed, yearly |
| Garage door | Lubricate, test reversal | Fixed, every 6 months |
| Septic | Pump tank | Fixed, every 3 years |
| Well | Water test | Fixed, yearly |
| Chimney | Inspect/sweep | Fixed, yearly |
| Irrigation | Winterise / spring start | Fixed, fall / spring |
| Lawn mower | Oil change, blade sharpen | Fixed, yearly in spring |
| Property | Test GFCI outlets | Fixed, monthly |
| Property | Check for leaks under sinks | Fixed, quarterly |
| Property | Reverse ceiling fans | Fixed, spring and fall |
| Property | Deep-clean / seasonal checklist | Fixed, spring and fall |

### B.3 Default budget categories

- Income: Salary, Other income, Reimbursements, Sale proceeds
- Housing: Mortgage/Rent, Property tax, Home insurance, HOA
- Utilities: Electricity, Gas/Heating, Water/Sewer, Trash, Internet, Phone
- Home: Maintenance, Repairs, Improvements/Projects, Furnishings, Tools, Cleaning supplies, Yard/Garden
- Food: Groceries, Dining out, Household consumables
- Pets: Food, Vet, Medications, Insurance, Supplies, Boarding/Sitting
- Transport: Fuel, Vehicle maintenance, Insurance, Parking/Transit
- Personal: Health, Clothing, Subscriptions, Gifts, Entertainment
- Savings/Goals: Emergency fund, Home fund (sinking), Other goals

### B.4 Default product categories (food and non-food)

Produce; Dairy & Eggs; Meat & Seafood; Bakery; Pantry staples (Grains, Pasta, Canned, Baking, Oils & Vinegars, Spices, Condiments); Frozen; Beverages; Snacks; Pet food & supplies (Cat food wet, Cat food dry, Treats, Litter, Medications); Household (Paper goods, Cleaning, Laundry, Batteries, Light bulbs, Filters); Personal care; Hardware consumables (Fasteners, Adhesives, Tape, Sandpaper, Blades & bits).

### B.5 Cat species profile defaults

| Item | Default |
|---|---|
| Core vaccines | FVRCP (kitten series, then 1 year, then every 3 years); Rabies (per local law: 1 or 3 years) |
| Non-core | FeLV (yearly for outdoor cats) |
| Preventives | Flea/tick monthly; Deworming quarterly (configurable) |
| Wellness | Annual exam; senior (10+) semi-annual |
| Weight warning | > 10% change in 30 days |
| Journal tags | Vomiting, Diarrhea, Constipation, Appetite ↑/↓, Thirst ↑, Lethargy, Hiding, Limping, Sneezing, Coughing, Scratching, Hairballs, Litter box avoidance, Aggression, Vocalising, Grooming change |
| Common conditions | CKD, Hyperthyroidism, Diabetes, Dental disease, FLUTD, IBD, Obesity, Arthritis, Asthma |
| Common lab tests | Creatinine, BUN, SDMA, Phosphorus, T4, Glucose, Fructosamine, ALT, ALP, Hematocrit, Urine specific gravity |

### B.6 Default tool categories and consumable presets

Categories: Hand tools; Power tools (drills/drivers, saws, sanders, routers, grinders, nailers); Measuring & layout; Plumbing; Electrical; Painting; Garden & outdoor; Automotive; Safety/PPE; Ladders & access; Batteries & chargers.

Consumable presets: Circular saw blade (diameter, arbor, teeth); Jigsaw blade (shank, TPI); Reciprocating blade; Drill bits (type, size set); Driver bits (1/4" hex, type); Sanding discs (diameter, attachment, grit); Sanding sheets; Oscillating blades; Router bits (shank); Trimmer line (diameter); Chainsaw chain (pitch, gauge, links); Mower blade (length, centre hole); Nails/staples (gauge, length); Respirator cartridges; Glue sticks.

---

## Appendix C: Example User Journeys

These drive E2E tests and demo data.

**C.1 Furnace filter (Maintenance + Pantry + Budget).**
Matt creates a Furnace asset from the HVAC category during onboarding and accepts the template library. A floating 90-day "Replace air filter" plan is created with consumable spec 16×25×1. The pantry has 2 filters in stock (non-food product, par level 1). At day 90 a task appears on Today with a push notification. Matt taps "Done", the completion sheet shows "Used 1 × 16×25×1 filter (2 in stock)", he confirms; stock becomes 1, next due is set 90 days from today, and the maintenance record appears on the furnace timeline. When stock later hits 1 (par level), "16×25×1 furnace filter" is added to the hardware shopping list. On purchase, put-away adds 4 filters and a $38 transaction attributed to the furnace asset and category Home → Maintenance. The furnace's total cost of ownership rises by $38.

**C.2 Bathroom remodel (Projects + Budget + Tools + Storage + Contacts).**
A project is created from the "Bathroom remodel" template with phases Demo, Rough-in, Inspection, Tile, Finish; budget $12,000 with a materials/labour/permits/contingency breakdown. Two plumbing quotes are requested from contacts with the plumbing specialty; one is accepted, creating a $3,200 committed line. The tools-needed list flags that the tile saw is "not owned" (added to wishlist, rent) and the oscillating tool is "loaned out to Dave" (return task created). Material lines for tile are entered with a calculator from the room dimensions. Purchases are captured on the phone with receipt photos and split across categories. The dashboard shows budget at 82% with a warning. On completion the retrospective prompts Matt to create a new "Bathroom exhaust fan" asset with its warranty, file two boxes of leftover tile to Garage → Shelf 3 → Bin 12 (labelled), and record final cost $12,940 vs budget.

**C.3 Cat medication (Cats + Tasks + Pantry + Notifications + Limited role).**
Pepper is diagnosed with hyperthyroidism at a vet visit; the visit records the diagnosis (creating a condition), the $215 cost attributed to Pepper, and a prescription for methimazole 2.5 mg twice daily, linked to a "Methimazole 2.5 mg 100ct" product with 100 on hand. Dose tasks appear at 08:00 and 20:00 with push notifications; each check-off records who gave it. The product run-out is projected 50 days out and a refill reminder fires 7 days before, with refills remaining shown. A quarterly "T4 bloodwork" monitoring plan is created against the pet. When Matt travels, a house-sitter is invited with the Limited role and given Pepper's care sheet; they see the feeding schedule and tonight's dose task and nothing else, and the dose they give is logged with their name.

**C.4 Where are the Christmas lights? (Storage + Labels).**
Alex searches "christmas" on their phone. The result "Storage: Christmas lights (3 strings)" shows the path Garage → Loft → Tote 7 with a photo of the tote. In the garage, scanning the QR label on Tote 7 confirms it and shows its full contents. After decorating, Alex marks the lights as "in use" location "Living room" for the season with a review-by date in January to move them back.

**C.5 Weekly grocery run (Pantry + Budget + Cats).**
The shopping list has auto-added items below par (oat milk, cat litter, black beans) plus Pepper's wet food (projected to run out in 4 days from the diet schedule). Alex checks items off in the store; a price-history hint shows the litter is cheaper at the other store. At home, the put-away sheet lists purchased products with default areas and expiry dates; Alex confirms in one tap per item, attaches the receipt photo, enters the $96.40 total, and the transaction is split by product category automatically with pet items attributed to Pepper.
