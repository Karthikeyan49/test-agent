# eco-sudar — local Docker stack (API + database)

Runs the eco-sudar PHP backend and its database locally so the API can be
exercised end-to-end (and so the SystemIntel **cross-layer oracle** can verify
that app writes actually land in the DB).

Two services:

| Service | Image | Host port | Purpose |
|---------|-------|-----------|---------|
| `db`  | `mariadb:11` | **3307** → 3306 | MariaDB (the dump uses `utf8mb4_uca1400_ai_ci`, a MariaDB-only collation) |
| `api` | `php:8.2-apache` (built from `Dockerfile`) | **8080** → 80 | PHP front controller (`api/index.php`) via Apache + mod_rewrite |

### Files in this directory

- `docker-compose.yml` — the two-service stack
- `Dockerfile` — `php:8.2-apache` + `pdo_mysql` + `mysqli` + `mod_rewrite`/`mod_headers` + the vhost
- `apache-vhost.conf` — docroot `= /var/www/html/api`, `AllowOverride All`
- `.env` — the app's **server-side** env, mounted to `/var/www/html/.env` (the parent of `api/`)
- `README.md` — this file

---

## 1. Start it

```bash
cd test-ecosudar/deploy   # from the repo root
docker compose up -d --build
```

On the **first** run the `db` container imports
`../database/u952547820_test (1).sql` (mounted read-only as
`/docker-entrypoint-initdb.d/01_schema.sql`) into the pre-created
`ecosudar_test` database. That takes a little while — the `api` container waits
for the DB healthcheck (`depends_on: condition: service_healthy`) before it is
considered up.

> **Demo admin login:** the seed dump's admin row was **sanitized** — the original
> production email + password hash were removed. The placeholder hash is not a valid
> credential. To log in as admin, set a new password after import, e.g.:
> ```sql
> UPDATE users SET password_hash = '<your bcrypt hash>' WHERE user_id = 37;
> ```
> SystemIntel's automated tests do not need admin login (pass a token via
> `--auth-token` instead).

Watch progress / confirm the import finished:

```bash
docker compose logs -f db     # look for "mariadbd: ready for connections" then Ctrl-C
docker compose ps             # both services should be "running"/"healthy"
```

## 2. Confirm the API responds

`/products` is a public GET route (no auth, no `/api` prefix), so it's the
simplest smoke test — it forces the app to read `.env`, connect to `db`, and
query the imported schema:

```bash
curl -i http://localhost:8080/products
```

Expect an HTTP 200 with a JSON body (a `success`/`data` envelope). A
`500 {"success":false,"message":"Server misconfiguration"}` means the `.env`
wasn't found at `/var/www/html/.env` or the DB isn't reachable — see
Troubleshooting below.

You can also hit the DB directly from the host on the published port 3307:

```bash
mysql -h 127.0.0.1 -P 3307 -u ecosudar -pecosudar ecosudar_test -e "SHOW TABLES;"
```

## 3. Test it with SystemIntel (drives the cross-layer oracle)

Run this from the SystemIntel project directory (where `cli.py` lives). It
points the app tests at the containerized API (`http://localhost:8080`) **and**
at the containerized DB on the host-published port **3307**, so the oracle can
read the database after each app write:

```bash
python3 cli.py test \
  --graph /home/karthikeyan/vscode/test-ecosudar/system_graph.json \
  --base-url http://localhost:8080 \
  --db mysql \
  --db-host localhost \
  --db-port 3307 \
  --db-name ecosudar_test \
  --db-user ecosudar \
  --db-password ecosudar \
  --no-browser
```

> **Why the `--db …` flags matter:** they are what makes the **CROSS-LAYER
> ORACLE** actually execute. Without them SystemIntel can only assert on HTTP
> responses; with them it connects to MariaDB and verifies the full path
> **app write → DB row → oracle check**. `--db mysql` is correct here — MariaDB
> speaks the MySQL wire protocol, so the MySQL client driver connects fine.
> Note the DB host/port here are the **host-published** `localhost:3307`, not the
> in-container `db:3306` used by the app's own `.env`.

---

## Reset / stop

```bash
docker compose down          # stop containers, keep the imported DB (db_data volume)
docker compose down -v       # ALSO wipe the DB volume -> next 'up' re-imports the dump
```

Re-import the schema (e.g. after changing the dump) by tearing the volume down
with `-v` and bringing the stack back up — the init scripts only run when the
`db_data` volume is empty.

## Troubleshooting

- **`500 Server misconfiguration` from the API** — the app couldn't read
  required DB keys. Confirm the env mount: `docker compose exec api cat /var/www/html/.env`
  (it must sit beside the `api/` dir, i.e. `/var/www/html/.env`, not inside `api/`).
- **404 for every route** — mod_rewrite/AllowOverride problem. Confirm the vhost
  is active: `docker compose exec api apache2ctl -M | grep rewrite` and that the
  docroot is `api/`.
- **API up before DB is ready / connection refused** — the DB is still importing;
  the healthcheck gate usually prevents this, but on a slow first import just wait
  and re-run the `curl`.
- **Port already in use (8080 or 3307)** — change the left-hand side of the
  `ports:` mappings in `docker-compose.yml` and re-run `up`.
- **The dump defines 7 stored procedures/triggers with a `DEFINER=` clause** for
  a Hostinger user that doesn't exist locally. The init import runs as `root`
  (which has the privilege to create objects with an arbitrary definer), so this
  imports cleanly; you may see a harmless warning in `docker compose logs db`.

## Notes

- The app's `.env` sets `DB_HOST=db` / `DB_PORT=3306` (the **internal** compose
  network address). The host only ever sees the DB via the published `3307`.
- `api/config/app.php` hardcodes `APP_ENV`; the `APP_ENV=development` line in
  `.env` is included per spec and is harmless (it documents intent even though
  that particular constant isn't read back from `.env`). `CORS_ORIGIN` and
  `JWT_SECRET` **are** read from `.env`.
