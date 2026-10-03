# Database migrations, backups and upgrades

Look's schema is managed by [Alembic](https://alembic.sqlalchemy.org/).
Migrations live in `backend/migrations/versions/`. The database URL and the
models come from the app itself (`app.config`, `app.models`), so there is no
separate database config to keep in sync.

## How it works

- **Startup:** both the REST API and the MCP server run
  `python -m app.migrate` before they start (see `docker-compose.yml`).
  If it fails, the container exits instead of serving. The app itself
  refuses to start if the database isn't at the latest revision.
- **`python -m app.migrate`** handles three cases:
  - **Managed database** (has an `alembic_version` table): `upgrade head`.
  - **Empty database:** `upgrade head` builds the whole schema.
  - **Pre-Alembic Look database** (made by the old `create_all()` startup):
    each existing table is checked against the baseline's columns. If
    anything doesn't match, nothing is changed and the error lists what's
    wrong. Otherwise the baseline runs; it only creates tables that are
    missing, so existing tables and rows are never recreated.

  On PostgreSQL the upgrade runs in a single transaction (a failure leaves
  the schema untouched) under an advisory lock, so the API and MCP
  containers starting together never migrate twice.
- **`/health`** reports `db_revision` (the database's Alembic revision) and
  `version` (the git commit the image was built from, if known).
- **Unknown tables are never dropped.** Autogenerate and `alembic check`
  ignore database objects that aren't in the models. For example,
  `recruiting_details` was left behind (with data) when recruiting tracking
  was removed, and it stays. Dropping anything must be a deliberate,
  hand-written migration.

All `alembic` commands below run from `backend/`, with the same environment
as the app (`DB_ENGINE`, `POSTGRES_*` or `SQLITE_PATH`). In Docker, prefix
them with `docker compose exec backend` (or `docker compose run --rm backend`
if it isn't running).

## Changing the schema

1. Change the models in `backend/app/models/`.
2. Generate a migration against an up-to-date database:
   ```bash
   cd backend
   python -m app.migrate                                    # db at head first
   alembic revision --autogenerate -m "add tasks.color"     # writes migrations/versions/<rev>_add_tasks_color.py
   ```
3. **Review it before applying.** Autogenerate is a draft:
   - Check every operation; remove anything you didn't intend.
   - Renames show up as drop + add, which loses data. Rewrite them (see
     "Migration rules" below).
   - Add explicit data migrations (`op.execute(...)`) where needed.
   - Make `downgrade()` honest: if it loses data, say so and guard it like
     the baseline does.
4. Apply it and run the checks:
   ```bash
   python -m app.migrate        # or: alembic upgrade head
   alembic check                # models and migrations agree?
   pytest -q                    # includes migration tests
   ```

CI (`.github/workflows/backend-tests.yml`) runs `alembic check` and the
migration tests on PostgreSQL, so a model change without a migration fails
the build.

## Migration rules

- Prefer additive, backward-compatible changes (new nullable columns, new
  tables, new indexes).
- Renames and big changes go **expand → migrate data → contract**: add the
  new column, copy data in an explicit migration, switch the code over, and
  only drop the old column in a later release.
- Never drop columns or tables just because they left the models.
- Data migrations are explicit (`op.execute`, bulk updates), never implied.
- If a downgrade would lose data, say so in the migration and require
  `-x allow-data-loss=true`, like the baseline.

## Everyday commands

| What | Command (from `backend/`) |
|---|---|
| Apply all migrations (safe for any database) | `python -m app.migrate` |
| Same, plain Alembic (managed databases only) | `alembic upgrade head` |
| Current revision of the database | `alembic current` |
| Latest revision in the code | `alembic heads` |
| History | `alembic history --verbose` |
| Models vs migrations drift check | `alembic check` |
| Step back one migration | `alembic downgrade -1` |
| Back to an empty database (**deletes all data**) | `alembic -x allow-data-loss=true downgrade base` |

## Fresh database vs existing database

- **Fresh install / empty database:** `python -m app.migrate` (Docker does
  this on start). Everything is created from the migrations.
- **Existing Look database from before Alembic:** also
  `python -m app.migrate`. It verifies the schema, keeps every existing table
  and row, creates any newer tables the old version didn't have, and records
  the revision. Back up first (`./scripts/backup.sh`).
- **`alembic stamp` vs `alembic upgrade`:**
  - `upgrade` runs migrations and changes the schema.
  - `stamp` only writes a revision into `alembic_version`, without
    checking or changing anything.

  You normally never need `stamp`. Use `alembic stamp 0001_baseline` only if
  you've confirmed by hand that a database already has exactly the baseline
  schema and `python -m app.migrate` refuses it for a reason you've decided
  to accept. Stamping a database that doesn't really match the baseline
  makes later migrations fail or corrupt data.

## Backups and restores

- **Manual backup:** `./scripts/backup.sh` writes
  `backups/todo-app-<timestamp>.sql.gz` (via `pg_dump` in the `db`
  container) and prunes backups older than `RETAIN_DAYS` (default 14).
- **In-app Update button:** the updater runs `pg_dump` into
  `backups/todo-app-<timestamp>-pre-update.sql.gz` after pulling the new
  images and before restarting anything. If the backup fails, nothing is
  restarted.
- **`./scripts/upgrade.sh`:** backs up before migrating (see below).
- `backups/` is gitignored; copy important backups off the machine.
- **Restore** (replaces all current data, asks for confirmation):
  ```bash
  ./scripts/restore.sh backups/todo-app-20261001-030000.sql.gz
  ```
  The backend and MCP restart afterwards and migrate the restored database
  to the current revision automatically, so restoring a backup taken by an
  older version is fine.

## Upgrading a running install

**From the web app:** the Update button (Settings → Updates & version): pull, then
backup, then restart (migrations run on start).

**From a shell:**
```bash
./scripts/upgrade.sh            # pull published images
./scripts/upgrade.sh --build    # or build from this checkout
```
It stops at the first error:
1. validates `.env` and `docker-compose.yml`, and that the expected
   database volume exists;
2. backs up the database;
3. pulls (or builds) the images;
4. runs `python -m app.migrate` in a one-off container, so nothing restarts
   if migrations fail;
5. restarts the stack;
6. waits for `/health` and prints the new `db_revision`.

## Troubleshooting

**Container exits with "Database migration failed".** Read the message:
`docker compose logs backend`. Your data is unchanged (failed migrations
roll back on PostgreSQL). Fix the cause, or restore and run the previous
image.

**"created before Look used migrations and doesn't match the baseline
schema".** A pre-Alembic database is missing a column the baseline
expects, or has an extra required column. The message lists them. Options:
add the missing column by hand (matching the baseline in
`migrations/versions/0001_baseline.py`), then re-run `python -m app.migrate`.
Or, once you've confirmed the differences are harmless, `alembic stamp
0001_baseline` (see above). Back up first either way.

**"Database schema is at X, but this version of Look needs Y".** The app
started without migrating. Run `python -m app.migrate`. If X is *newer*
than Y, you're running an older image against a newer database: run the
newer image, or restore a backup from before the upgrade.

**`alembic check` reports differences.** Someone changed a model without
a migration (or the database was changed by hand). Generate a migration
(see "Changing the schema") or revert the model change.

**`Can't locate revision identified by '…'`.** The database was migrated by
a newer version of Look than the code you're running. Use the newer code,
or restore a backup.

**The data looks empty after an upgrade.** Don't restore over it yet: check
`docker volume ls | grep postgres_data`. If an old volume like
`look_postgres_data` exists next to `todo-app_postgres_data`, the compose
project name changed. Set `COMPOSE_PROJECT_NAME` to the old prefix in
`.env` and restart. Your data is in the old volume.
