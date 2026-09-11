# Running Homestead

Everything here assumes the reference `deploy/docker-compose.yml`.

## First run

```
cp deploy/.env.example deploy/.env      # optional; every value has a default
docker compose -f deploy/docker-compose.yml up -d
```

Open the app and complete the two-step setup: name the household and create the admin
account. There is no default password and no account to disable.

## Configuration

All configuration is environment variables. Any variable `X` can instead be supplied as
`X_FILE` pointing at a file, which is how Docker secrets work.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8080` | Listen port. |
| `HOMESTEAD_DATA_DIR` | `/data` | Database, uploads and backups live here. |
| `HOMESTEAD_SECRET_KEY` | empty | Encrypts sensitive fields at rest. Generate with `openssl rand -base64 48` and keep it. |
| `TRUST_PROXY` | `false` | Set true behind a reverse proxy so client IPs and protocol are read from `X-Forwarded-*`. |
| `BASE_PATH` | empty | Serve under a sub-path, e.g. `/homestead`. |
| `SESSION_DAYS` | `30` | How long "stay signed in" lasts. |
| `MAX_UPLOAD_BYTES` | `52428800` | Upload size cap. |
| `SCHEDULER_ENABLED` | `true` | The daily reminder pass. |
| `SMTP_*` | empty | Email reminders. Without these, reminders stay in the in-app inbox. |
| `NTFY_URL`, `NTFY_TOPIC` | empty | Push through a self-hosted ntfy. |
| `GOTIFY_URL`, `GOTIFY_TOKEN` | empty | Push through Gotify. |
| `NOTIFY_WEBHOOK_URL` | empty | POST notifications as JSON to your own endpoint. |
| `HOMESTEAD_EXTERNAL_LOOKUPS` | `false` | Opt in to looking unknown barcodes up externally. |
| `HOMESTEAD_WEB_DIR` | next to the server | The built web client. Found automatically; set it only for an unusual layout. |

## Backups

The database is a single SQLite file, but do not copy it while the server is running:
use the online backup, which takes a consistent snapshot.

```
docker compose exec homestead node apps/server/dist/cli.js backup
docker compose exec homestead node apps/server/dist/cli.js list-backups
```

Backups land in `$HOMESTEAD_DATA_DIR/backups`. Admins can also take one from
Settings → Data, which shows what is on disk.

A full backup is the backup file **plus** `$HOMESTEAD_DATA_DIR/files`. The uploads are
content-addressed, so they deduplicate and never change once written — an incremental
file sync handles them well.

### Restoring

```
docker compose down
# put the .db file somewhere the container can see, then:
docker compose run --rm homestead node apps/server/dist/cli.js restore --from=/data/backups/<file>.db
docker compose up -d
```

Restore refuses to overwrite an existing database unless you pass `--force`. Migrations
run automatically afterwards, so restoring an older backup into a newer version works.

## Exporting everything

Settings → Data → *Download an export*, or `GET /api/v1/admin/export`.

The ZIP contains every table as both CSV and JSON Lines, every uploaded file under its
content hash, and a `schema.json` manifest. Money is integer minor units; dates are ISO
8601. Nothing in it requires Homestead to read.

## Upgrading

```
docker compose pull && docker compose up -d
```

Migrations are forward-only and run on start. Take a backup first; the CI pipeline tests
that migrations apply to both an empty database and the previous release's demo data, but
your data is yours to protect.

## Reminders

A scheduler runs once per calendar day in the household timezone. It materialises the
tasks that schedules owe, generates pet doses, flags missed ones, and emits reminders.

Every reminder carries a dedupe key encoding its occasion — `task:<id>:<date>`,
`warranty:<id>:30`, `budget:<category>:<month>:80`. The uniqueness constraint is in the
database, so the pass is safe to run repeatedly and safe to run late. If the container was
down for three days, the next start catches up and sends each outstanding reminder once.

Check it is running: Settings → Data shows the last successful pass and any failed
deliveries. Force one with `node apps/server/dist/cli.js run-scheduler`.

## Carbon factors

The shipped emission factors are approximations drawn from public datasets — the US EPA
GHG Emission Factors Hub for energy and transport, Poore & Nemecek (2018) for food, the
ICE database for materials, IPCC AR5 for refrigerant GWPs, DEFRA for water and waste.
Each one carries its source and a confidence, and each is marked as a default requiring
local verification. They are a starting point, not an authority.

The one worth correcting first is your grid. `electricity.grid` ships as a national
average; your utility publishes its own figure, usually in an annual disclosure, and it
can differ by a factor of three. Footprint → Factors → edit, and say where the number
came from.

Correcting a factor does not change anything already recorded. Every emission stores the
factor value it was computed with, so history stays as it was measured. To bring an
existing period onto a corrected factor, use Footprint → Factors → **Recalculate**: it
previews the diff, writes nothing until you apply, and records what it did in the audit
log.

Two ways a household's energy reaches the system, and they do not double count:

- **Bills.** Give a recurring bill its `meteredUnit` and factor key, and paying it records
  the cost and the emissions together.
- **Meters.** Put a meter on an asset (Footprint → Energy → Meters), then record the dial
  reading. Consumption is the difference from the previous reading, so nobody types a
  usage figure that a bill already carries. Where a bill covers a period a meter already
  measured, the bill attaches its cost to the existing activity rather than creating a
  second one.

## Health checks

| Endpoint | Meaning |
|---|---|
| `/healthz` | The process is up. |
| `/readyz` | The database answers. |

## Troubleshooting

**Reminders are not arriving.** Settings → Data shows failed deliveries. The in-app inbox
always works; email needs `SMTP_HOST` and a `SMTP_FROM` your server will accept.

**"That record changed since you loaded it."** Two people edited the same thing. Reload
and redo the edit; the first write won by design.

**Uploads fail behind a proxy.** Raise the proxy body limit. nginx needs
`client_max_body_size` at least as large as `MAX_UPLOAD_BYTES`.

**A tool shows as unavailable.** It is out on loan or marked as needing repair. Storage →
Lent out returns it.

**An activity recorded no emissions.** Either no factor matched its type, or the quantity
could not be converted into the factor's unit — "2 cans" only becomes kilograms if the
product says what a can weighs. Set `unitMassKg` on the product, or record the activity in
a unit compatible with the factor. The activity is still saved either way; it just carries
no emission rows.

**An intervention says it saves nothing.** It is measured against fuel this house has no
record of burning. An induction range correctly shows zero saving in a house with no gas.
The row says whether it is `measured` or `estimated`, and what it was measured from.
