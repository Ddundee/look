# Raspberry Pi / Linux home server deployment

This assumes a Raspberry Pi 4 or 5 running a 64-bit OS (Raspberry Pi OS
64-bit, or Ubuntu Server for ARM64) — 64-bit is required for the Postgres
and Node/Python images used here. Everything in this guide applies
equally to any other Linux box (an old laptop, a NUC, a VPS you own,
etc.) — just skip the Pi-specific parts.

## 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
# log out and back in for the group change to take effect
```

Verify:

```bash
docker --version
docker compose version
```

Docker's install script enables and starts the `docker` systemd service by
default, so it comes back up automatically after a reboot. Confirm with:

```bash
sudo systemctl is-enabled docker   # should print "enabled"
```

If it doesn't, enable it explicitly: `sudo systemctl enable docker`.

## 2. Get the code onto the Pi

```bash
git clone <your-fork-url> todo-app
cd todo-app
```

(Or `scp`/`rsync` the repo over if you don't want the Pi to have its own
git remote access.)

## 3. Configure environment

```bash
cp .env.example .env
nano .env   # or vim/whatever you have
```

At minimum, change these from their placeholder values:

- `POSTGRES_PASSWORD` — random string
- `API_TOKEN` — random string (`openssl rand -hex 32`); this is what MCP
  clients and any scripts will authenticate with
- `SESSION_SECRET` — a **different** random string (`openssl rand -hex 32`)
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` — your web UI login (only used to
  seed the account on first boot)
- `APP_TIMEZONE` — your local IANA timezone (e.g. `America/New_York`), so
  "today" and due dates line up with your actual day

Leave `BIND_HOST=0.0.0.0` unless you specifically want to restrict which
network interface the ports are published on (see
[`TAILSCALE.md`](TAILSCALE.md) for why you might set it to your Tailscale
IP instead).

## 4. Start the stack

Images are published to GitHub Container Registry (`ghcr.io/ddundee/look-*`,
see "Published images" below) by CI on every push to `main`, prebuilt for
both `amd64` and `arm64` — pulling them is much faster than building on a
Pi:

```bash
docker compose pull
docker compose up -d
```

If you've made local changes (or are running a fork without CI wired up),
build from source instead:

```bash
docker compose up -d --build
```

First build takes a few minutes on a Pi (compiling nothing — these are
all pre-built wheels/binaries for arm64, but downloading + `npm ci` +
`next build` still takes some time on Pi-class CPUs). Watch progress:

```bash
docker compose logs -f
```

Check everything is healthy:

```bash
docker compose ps
```

All four services (`db`, `backend`, `mcp`, `frontend`) should show
`healthy` within about 30 seconds of the containers starting.

## 5. Verify

From another machine on the same LAN:

```bash
curl http://<pi-ip>:8000/health
```

Then open `http://<pi-ip>:3000` in a browser and log in.

## Surviving a reboot

Every service in `docker-compose.yml` has `restart: unless-stopped`. Combined
with the Docker daemon itself starting on boot (step 1), a `sudo reboot`
brings the whole stack back automatically — no manual `docker compose up`
needed after a power cycle. Verify by rebooting once and checking
`docker compose ps` afterward.

## Updating

**From the web app (normal way).** Every push to `main` publishes new
images. A few minutes later the app shows an "Update available" toast
listing what changed. Press **Update**: the `updater` container pulls the
new images and restarts `backend`, `mcp` and `frontend`, then the page
reloads itself on the new version (roughly 10 to 30 seconds of downtime).
**Later** hides the toast until the next new version. Settings → Version
shows what's running and has a **Check for updates** button.

The updater never touches `db` (your data lives in the
`todo-app_postgres_data` volume), the tunnel, or itself.

**From a shell (fallback, and the only way to update the updater):**

```bash
cd todo-app
git pull              # only needed if docker-compose.yml itself changed
docker compose pull   # latest images from ghcr.io
docker compose up -d
```

This only restarts services whose image actually changed. Take a backup
before anything bigger than a routine update; see the root `README.md`.

To turn in-app updates off, set `UPDATER_URL=` (empty) in `.env` and
`docker compose stop updater`.

The Compose project name is pinned to `todo-app` at the top of
`docker-compose.yml`. Don't change it: Docker names the database volume
after it, and a different name would start an empty database.

## Published images (GitHub Container Registry)

`.github/workflows/docker-publish.yml` builds three images for
`linux/amd64` and `linux/arm64` on every push to `main` and pushes them
to GHCR, tagged `latest` and with the short commit SHA:

- `ghcr.io/ddundee/look-backend` (backend and mcp)
- `ghcr.io/ddundee/look-frontend`
- `ghcr.io/ddundee/look-updater`

It logs in with the workflow's own `GITHUB_TOKEN`, so there are no secrets
to set. Each image records the commit it was built from
(`org.opencontainers.image.revision`), which is how the updater knows
whether you're behind.

**One-time setup:** new GHCR packages start private. After the first
successful run, make each package public so machines can pull without
logging in: GitHub → your profile → **Packages** → the package →
**Package settings** → **Change visibility** → **Public**.

Forks: set `IMAGE_PREFIX` (e.g. `ghcr.io/yourname/look`) and
`UPDATER_GITHUB_REPO` (e.g. `yourname/look`) in `.env`.

Building natively instead (`docker compose up -d --build`, on the Pi or
anywhere) also works; those local images carry no commit label, so the
app will offer the published update once.

## Connecting ChatGPT via OpenAI Secure MCP Tunnel (optional)

If you want ChatGPT (or Codex, or the Responses API) to talk to this
project's MCP server without opening any inbound port on your network,
OpenAI's [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
runs a small client ([`openai/tunnel-client`](https://github.com/openai/tunnel-client))
next to your MCP server that makes an **outbound-only** HTTPS connection to
OpenAI, long-polls for queued requests, and forwards them to `mcp:8001`
locally. Nothing on your network accepts inbound traffic, and the tunnel
carries only MCP JSON-RPC, not your whole network.

A ready-to-use `openai-tunnel` service is already defined in
`docker-compose.yml`, gated behind a Compose profile so it never runs
unless you ask for it.

**1. Create a tunnel** at
[platform.openai.com → Settings → Tunnels](https://platform.openai.com/settings/organization/tunnels)
(requires the Tunnels *Read + Manage* permission on your org). Associate it
with the ChatGPT workspace you want to use it from, and copy the resulting
`tunnel_id` (looks like `tunnel_0123456789abcdef0123456789abcdef`).

**2. Create a runtime API key** at
[platform.openai.com → Settings → API keys](https://platform.openai.com/settings/organization/api-keys)
scoped with Tunnels *Read + Use* for that tunnel.

Both of these are account actions only you can do — do this in your own
browser rather than pasting the key anywhere.

**3. Add both values to `.env`:**

```bash
OPENAI_TUNNEL_ID=tunnel_...
OPENAI_TUNNEL_API_KEY=sk-...
```

**4. Start the tunnel** alongside the rest of the stack:

```bash
docker compose --profile openai-tunnel up -d
```

This runs `ghcr.io/openai/tunnel-client` pointed at `http://mcp:8001/mcp`
(the same MCP service everything else in this stack uses) and injects your
existing `API_TOKEN` as the `Authorization: Bearer` header the MCP server
already requires — the token never leaves this host; it's only used on the
`tunnel-client → mcp` hop, not sent to OpenAI as a header value (it's
resolved from the container's own environment).

**5. Turn on Developer Mode in ChatGPT** — required to add any
custom/unverified connector. In ChatGPT: Settings → **Security and
login** → scroll to **Developer mode** → flip the toggle (labeled
"Elevated risk" — expected for any self-hosted MCP server).

**6. Create the connector**: go to
[ChatGPT → Settings → Plugins](https://chatgpt.com/#settings/Connectors)
(this is where that link actually lands, despite the name) → **Browse
plugins** → **+** to open "New Plugin", then:

- **Name**: anything, e.g. "Personal Tasks".
- **Connection**: switch from *Server URL* to **Tunnel**, then select
  your tunnel or paste the `tunnel_id` from step 1.
- **Authentication**: choose **No Auth**, not OAuth. `tunnel-client`
  already injects the `Authorization: Bearer` header itself on the hop
  to your MCP server (that's what `MCP_EXTRA_HEADERS` above does), so
  ChatGPT never needs its own auth handshake with it — OAuth here just
  makes ChatGPT try (and fail) to discover a flow your server doesn't
  have.
- Check "I understand and want to continue" under the custom-MCP-server
  risk warning — standard friction for any self-hosted server.

Click **Create**. Your tasks are now reachable from ChatGPT.

To stop just the tunnel without touching the rest of the stack:

```bash
docker compose --profile openai-tunnel stop openai-tunnel
```

Everything else in this stack runs exactly as before if you never set
these two variables or pass `--profile openai-tunnel` — this integration
is entirely opt-in.
