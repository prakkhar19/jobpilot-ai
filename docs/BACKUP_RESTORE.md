# Backup & restore

What needs backing up: the PostgreSQL database (all records) and the `appdata` volume (original resumes,
generated documents, screenshots and — unless you set `APP_SECRET_KEY` — the auto-generated app secret that
decrypts stored API keys).

## Back up

```bash
make backup                     # → backups/jobpilot-<UTC timestamp>/{db.dump, appdata.tar.gz, MANIFEST.txt}
./scripts/backup.sh /mnt/safe   # custom destination
```

The stack must be running. Backups contain personal data and secrets: store them encrypted (e.g. `age`, `gpg`, an
encrypted disk) and off the server. Schedule with cron, e.g. `0 3 * * * cd /opt/jobpilot-ai && ./scripts/backup.sh`.

## Restore

```bash
make restore DIR=backups/jobpilot-20261109T030000Z
```

The script asks you to type `RESTORE`, stops the app services, replaces the database (`pg_restore --clean`),
extracts the files over the data volume, and starts everything again (migrations run automatically, so a backup
from an older version is upgraded on start).

## Moving to a new server

Copy the backup directory and your `.env` (needed if you set `APP_SECRET_KEY`), clone the repository, run
`docker compose up -d`, then `make restore DIR=...`.

## Data export & deletion (per user)

Users can download all their data as a ZIP (*Security & Privacy → Export*) and permanently delete their account,
which removes every database row they own and their files.

## Safe reset

To start completely fresh **(deletes all data)**: `make backup` first, then `docker compose down -v`, then
`docker compose up -d`. Normal rebuilds (`docker compose up --build`) never delete data.
