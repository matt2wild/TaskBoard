# Homestead

A self-hosted home management application. One household, one container, your data.

It keeps a canonical record of the house, the things in it, the work done to it, the money
spent on it, the greenhouse gases it releases, the food it buys and grows, and the animals
living in it — and connects those records so each module makes the others smarter.

Completing "replace the furnace filter" writes the maintenance history, takes a filter off
the shelf, books the cost against the furnace, reschedules the next change 90 days from
today, and puts a filter on the shopping list because you are now below par. That is the
whole idea.

The same idea applies to carbon. An oil delivery is one event that is money *and* gallons
*and* emissions, entered once; the heat pump that would replace the boiler is then argued
for in dollars per tonne against what this house actually burned last winter, not against
a national average.

And to the loops. A tomato goes seed → plant → harvest → pantry → seed, and every step is
a link rather than a memory: the lot you sowed from knows which plant it came from, two
summers back. A carton of milk goes pantry → the pile → a bed, in one action, and the app
can tell you what the bin would have made of it instead.

```
docker compose -f deploy/docker-compose.yml up -d
```

Then open http://localhost:8080 and create your household.

## What is in it

| Module | What it does |
|---|---|
| **Tasks** | Recurring chores with two kinds of repeat: *fixed* (the bins go out Tuesday, whatever happened last week) and *floating* (90 days after you actually changed the filter). Lists, a kanban board and a calendar over every dated thing in the house. |
| **Assets and maintenance** | Appliances, systems and fixtures with age, warranty, cost of ownership and history. A shipped library of ~30 maintenance templates keyed by category, so adding a water heater offers "flush the tank yearly" rather than a blank form. |
| **Renovation projects** | Phases, tasks, materials, quotes, permits, inspections, a decision log, live budget against actuals, and a retrospective that files the leftovers into storage and creates the new asset. |
| **Budget** | Transactions with splits and *attributions*: money is recorded against the asset, project or pet it was for, not just a category. Monthly budgets with rollover, recurring bills, CSV import with duplicate detection, and a ten-year forecast built from asset lifespans and project ideas. |
| **Footprint** | Carbon as a second unit of account, not a report. Emissions come from the same events as the costs and attach to the same assets, projects and pets. Meter readings difference into consumption on their own; bills carry their quantity; a factor library of ~70 entries names its source and confidence for every number. Interventions — insulation, a heat pump, solar — are costed against this house's own fuel use and its own electricity price, ranked by what a tonne actually costs, and an accepted one becomes a project. |
| **Garden** | Beds with a history, a variety library carrying botanical families so crop rotation is checked rather than remembered, seed held as real stock with its viability in seasons and its germination tested, plantings that generate their own tasks from days to maturity and *your* frost dates, and harvests that enter the pantry as ordinary stock. |
| **Compost** | Systems and their inputs, a material library of carbon-to-nitrogen ratios, the balance computed as the ratio of the totals rather than the average of the ratios, pile management by temperature, and finished compost back to a bed as a single record. |
| **Repair and reuse** | Repairs that extend a thing's life and push its replacement out of the ten-year forecast, a repair-or-replace comparison per year of service in money *and* carbon, circulation by route, and seed saved from your own plants. |
| **Food and pantry** | Barcode scanning, expiry tracking, par levels that keep the shopping list current, a put-away flow that turns a finished trip into stock plus one receipt plus price history, waste logging, and recipes measured against what is actually in the house. |
| **Storage** | A location tree from floor down to bin, QR labels you can stick on a tote, "where is X" search with a breadcrumb, loans, a declutter queue and an insurance valuation. |
| **Tools** | Tool inventory with battery platforms, consumable specs matched to products, kits, checkout against a project, and a rent-or-buy wishlist. |
| **Cat health** | Dose schedules that become checkable tasks, vet visits that create conditions and prescriptions in one step, weight trends with a rapid-change warning, a symptom journal, lab result charts, insurance claims, and a printable care sheet for a house-sitter. |

Plus contacts with their full history with you, a document library, an activity log,
notifications, and an export that does not need Homestead to read it.

## Principles

- **It works with no internet.** External lookups are opt-in and off by default. No
  telemetry, no phone-home, no account anywhere else.
- **Your data outlives the software.** The export is a ZIP of every table as CSV *and*
  JSON Lines, plus every file you uploaded, plus a manifest.
- **Reminders are trustworthy.** Every reminder is keyed to its occasion, so running the
  daily pass twice, or catching up after the container was down, produces it exactly once.
- **One event, every measure.** A thing is entered once and counted in every unit that
  applies to it — money, quantity, energy, carbon. Nothing is reconciled after the fact,
  because nothing was ever recorded twice.
- **No number without its derivation.** Every emission stores the factor and the factor
  value it was computed with, so any total decomposes back to the activities behind it.
  Correcting a factor never silently rewrites what you already recorded.
- **Aggregate late.** Store what was measured — grams of methane, not only its equivalence —
  and derive the summary when it is read. A number collapsed on the way in cannot be
  un-collapsed on the way out, which is why the twenty-year view is a control rather than a
  migration.
- **Never flatter the household.** What you avoided is not what you emitted, and the two
  are reported apart. A failed planting, a repair that did not hold and a pile that went
  anaerobic are all recorded, because a record exists to be useful rather than encouraging.
- **Boring technology.** One container, one SQLite file, one directory of uploads.

## Running it

The reference `deploy/docker-compose.yml` needs nothing but a volume. Everything in
`deploy/.env.example` is optional: without SMTP, reminders simply live in the in-app inbox.

Reverse proxy examples for Caddy, nginx and Traefik are in `deploy/`.

### Try it with demo data

```
docker compose exec homestead node apps/server/dist/cli.js seed-demo
```

That creates a household with a house, its systems, a bathroom remodel mid-flight, a
stocked pantry, tools (one lent to a neighbour), an oil-heated winter with meter readings
behind it, four raised beds part-way through a season — including tomatoes grown from seed
saved two summers ago, and a courgette that the vine borer got — a hot compost heap with a
season of temperature readings, a fridge that was repaired rather than replaced, and two
cats, one newly diagnosed with hyperthyroidism and on twice-daily medication. Sign in as
`matt` / `homestead`.

### Command line

```
node apps/server/dist/cli.js <command>

  migrate              Apply database migrations
  seed                 Insert the default categories and template library
  seed-demo            Create a demo household with realistic data
  create-user          --username --password --email [--role]
  reset-password       --username --password
  promote              --username
  backup               [--out=<path>]
  restore              --from=<path> [--force]
  run-scheduler        Run the daily reminder pass now
  purge-trash          [--days=30]
  status
```

## Development

```
npm install
npm test           # 252 tests across the domain packages and the API
npm run dev        # server on :8080, web on :5173
```

The web dev server proxies `/api` to the server, so sign-in works as it does in production.

| Path | What lives there |
|---|---|
| `packages/shared` | Recurrence, money, carbon, gases, garden and compost arithmetic, units and the shared vocabulary. Pure, heavily tested. |
| `apps/server` | Fastify API, Drizzle schema, the scheduler, the CLI. |
| `apps/web` | React client. No UI framework, no chart library, no icon font. |
| `docs/REQUIREMENTS.md` | The full requirements document this was built from. |
| `docs/adr/` | Why the load-bearing decisions were made, and what they cost. |
| `legacy/` | The original TaskBoard prototype, kept for reference. |

The API documents itself at `/api/v1/openapi.json`, with a short guide at `/api/v1/docs`.
The web client uses those endpoints and no others.

## Licence

AGPL-3.0-or-later.
