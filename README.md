# Axelyn Signal

Axelyn Signal turns one raw observation into a small, ranked set of editorial briefs. Four bounded model calls are controlled by application code; the agents never chat with each other, keep hidden memory, or publish content.

```text
Manual signal
    │
    ▼
Scout ── stop weak signals early
    │ structured ScoutOutput
    ▼
Explorer ── select 1–3 relevant primary jobs, create ≤12 angles
    │ structured candidates
    ▼
Critic ── KEEP / REWORK / KILL (KILLs are removed in code)
    │ surviving candidates + critiques
    ▼
Strategist ── component scores + penalties + editorial briefs
    │ deterministic weighted scoring in application code
    ▼
3–5 ranked briefs for human review
```

The web response streams real stage events, so the interface reflects the actual orchestrator state rather than simulating progress.

## Run with Docker Compose

Requirements: Docker Engine with Docker Compose v2.

```bash
cp .env.example .env
```

Before starting, edit `.env` and replace both of these values:

- `POSTGRES_PASSWORD`: a strong, unique database password.
- `SETTINGS_ENCRYPTION_KEY`: the output of `openssl rand -base64 32`.

The encryption key protects web-managed credentials. Keep a secure backup: losing or changing it makes the saved OpenRouter key unreadable.

Start PostgreSQL and the application:

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000), choose **Settings**, and save an OpenRouter API key. The key is encrypted with AES-256-GCM before it is stored in PostgreSQL and is never returned to the browser after saving.

Useful operations:

```bash
docker compose ps
docker compose logs -f app
docker compose up -d --build
docker compose down
```

PostgreSQL data lives in the named `postgres_data` volume. `docker compose down` preserves it. `docker compose down -v` permanently removes the database and all pipeline history.

Both published ports bind to `127.0.0.1`, so the application and database are available to the local machine but not directly exposed on its network interfaces.

The Compose defaults cap the app at 1 CPU/1 GiB, PostgreSQL at 0.75 CPU/768 MiB, and the tunnel at 0.25 CPU/256 MiB. They also rotate container logs and give Next.js 30 seconds to finish in-flight requests during shutdown. Override the corresponding `*_CPUS` or `*_MEMORY_LIMIT` values in `.env` when the host has different constraints.

## Automatic VPS deployment with GitHub Actions

The workflow in `.github/workflows/ci-cd.yml` runs lint, tests, and a production build for every push and for pull requests into `main`. A validated commit is deployed automatically only when it is on `main`.

Deployment runs from a temporary GitHub-hosted runner over SSH. It checks out the exact validated commit on the VPS, rebuilds the Compose application image, waits for the existing health checks, and restores the previous application image when a new release does not become healthy. The production `.env` remains on the VPS and is never copied into GitHub Actions.

One-time VPS setup:

1. Install Docker Engine and Docker Compose v2. Create a dedicated, non-root deployment account and grant it access to the Docker daemon:

```bash
sudo useradd --create-home --shell /bin/bash github-deploy
sudo usermod --append --groups docker github-deploy
```

Docker access is effectively root-level access to the VPS, so protect this account and allow only key-based SSH authentication. The VPS SSH port must be reachable from GitHub-hosted runners.

2. Create the release directory and production environment file:

```bash
sudo install -d -m 0750 -o github-deploy -g github-deploy /opt/axelyn-signal
sudo install -d -m 0700 -o github-deploy -g github-deploy /opt/axelyn-signal/incoming
sudo install -d -m 0750 -o github-deploy -g github-deploy /opt/axelyn-signal/releases
sudo touch /opt/axelyn-signal/.env
sudo chown github-deploy:github-deploy /opt/axelyn-signal/.env
sudo chmod 0600 /opt/axelyn-signal/.env
sudoedit /opt/axelyn-signal/.env
```

Copy the settings from `.env.example` and replace at least `POSTGRES_PASSWORD`, `SETTINGS_ENCRYPTION_KEY`, `CLOUDFLARE_TUNNEL_TOKEN`, and `OPENROUTER_SITE_URL` with production values.

3. Generate a dedicated deployment key on a trusted workstation. Do not add a passphrase because the workflow is non-interactive:

```bash
ssh-keygen -t ed25519 -C axelyn-github-deploy -f axelyn-github-deploy -N ''
```

Using an existing VPS administrator session, put the single line from `axelyn-github-deploy.pub` into `/home/github-deploy/.ssh/authorized_keys` and set the directory/file permissions to `0700`/`0600`. Confirm that the key can log in and that the account can run `docker info` and `docker compose version` before continuing:

```bash
ssh -i axelyn-github-deploy github-deploy@your-vps-host 'docker info && docker compose version'
```

4. From a trusted network, collect the VPS SSH host keys and verify their fingerprints against the host before trusting them:

```bash
ssh-keyscan -H -p 22 your-vps-host > axelyn-known-hosts
ssh-keygen -lf axelyn-known-hosts
```

5. In GitHub, open **Settings → Secrets and variables → Actions** and add these production secrets:

- `VPS_HOST`: the VPS hostname or IP address.
- `VPS_PORT`: the SSH port, normally `22`.
- `VPS_USER`: `github-deploy` or the dedicated account name.
- `VPS_SSH_PRIVATE_KEY`: the complete contents of the private deployment key.
- `VPS_SSH_KNOWN_HOSTS`: the complete, verified contents of `axelyn-known-hosts`.

6. Merge the workflow into `main`, or run **CI and VPS deploy** manually from the Actions tab using the `main` branch. GitHub transfers an archive of the exact validated commit into a unique directory under `/opt/axelyn-signal/releases` and updates `/opt/axelyn-signal/current` only after the release becomes healthy. This also works if the repository is made private because the VPS does not clone from GitHub.

The deployment starts the Cloudflare Tunnel profile by default. If the VPS intentionally does not use that profile, create a GitHub Actions repository variable named `AXELYN_COMPOSE_PROFILE` with the value `none`. Never commit either SSH key or the production `.env`.

## Protect it with Cloudflare Access

The included optional `tunnel` service is the intended production access path. It uses an outbound Cloudflare Tunnel, while Cloudflare Access authenticates the operator before traffic reaches Axelyn Signal.

1. Choose the hostname, for example `signal.example.com`.
2. In Cloudflare Zero Trust, go to **Access controls → Applications**, create a **Self-hosted and private** application, and add that public hostname. Do this before publishing the tunnel route so there is no unauthenticated exposure window.
3. Add an Allow policy for only the exact emails, identity-provider groups, or device posture you trust. Access is deny-by-default; do not add `Everyone` or all OTP users to the Allow policy.
4. Select an existing identity provider. For a small V1, Cloudflare One-Time PIN with an exact-email Allow policy is sufficient. Enable MFA at the identity provider where practical.
5. In Cloudflare, go to **Networking → Tunnels**, create a remotely managed tunnel, and copy its tunnel token.
6. On the tunnel's **Routes** tab, add a **Published application** route for the hostname with service URL `http://app:3000`.
7. In that route's origin settings, enable **Protect with Access** so `cloudflared` validates the Access JWT before proxying a request to the app.
8. Set `CLOUDFLARE_TUNNEL_TOKEN` in the uncommitted `.env` file and set `OPENROUTER_SITE_URL` to the HTTPS hostname.
9. Start the full stack:

```bash
docker compose --profile tunnel up -d --build
```

On a VPS, keep the Compose loopback bindings unchanged and do not open ports 3000 or 5432 in the firewall. The tunnel does not need inbound HTTP/HTTPS ports. The tunnel token is a sensitive credential; rotate it in Cloudflare if it is exposed.

Test one authorized identity and one unauthorized identity before considering the deployment complete. With **Protect with Access** enabled, `cloudflared` validates the JWT at the tunnel boundary. If a future deployment exposes the origin through another route, add application-side validation too; never trust the identity header by itself.

## Run the application outside Docker

Run PostgreSQL first (the Compose database is suitable), then:

```bash
cp .env.example .env.local
npm install
npm run dev
```

`DATABASE_URL` in `.env.local` must point to PostgreSQL. Schema migrations run automatically and are guarded so concurrent application starts are safe.

Open [http://localhost:3000](http://localhost:3000), then add the OpenRouter key through **Settings**.

Useful checks:

```bash
npm test
npm run lint
npm run build
```

## Configuration

Each agent model can be replaced independently through environment configuration:

```dotenv
SCOUT_MODEL=google/gemini-2.5-flash-lite
EXPLORER_MODEL=google/gemini-2.5-flash
CRITIC_MODEL=deepseek/deepseek-v3.2
STRATEGIST_MODEL=anthropic/claude-haiku-4.5
```

The defaults deliberately use an inexpensive Scout, a mid-tier creative Explorer, a different model family for Critic, and a balanced Strategist. Model slugs are configuration, not architectural dependencies. Temperatures and maximum output-token budgets are also independently configurable with the `*_TEMPERATURE` and `*_MAX_OUTPUT_TOKENS` variables in `.env.example`.

OpenRouter's returned `usage.cost` is stored when present. Per-token prices in `.env.example` provide a fallback estimate and should be refreshed when model pricing changes. The OpenRouter API key is the only model credential managed through the V1 web interface; model selection remains deployment configuration so a credential change cannot silently alter editorial behavior.

## Architecture boundaries

- Domain schemas: `src/domain/schemas.ts`
- Deterministic scoring: `src/domain/scoring.ts`
- Agent/model configuration: `src/config/agents.ts`
- Editable Axelyn context: `src/config/axelyn-context.ts`
- Separate prompts: `src/prompts/`
- OpenRouter gateway: `src/llm/openrouter.ts`
- Pipeline state machine: `src/pipeline/orchestrator.ts`
- PostgreSQL connection and migrations: `src/persistence/postgres.ts`
- PostgreSQL repository: `src/persistence/postgres-repository.ts`
- Encrypted credential store: `src/security/`
- Streaming API: `src/app/api/pipeline/route.ts`
- Operator UI: `src/components/signal-workspace.tsx`

The V1 Axelyn context is intentionally conservative because no detailed company proof library was supplied. Review `src/config/axelyn-context.ts` before production and replace the working positioning, credible-experience areas, and exclusions with verified company language.

## Persistence

PostgreSQL stores:

- raw signals and optional context;
- pipeline and agent statuses/timestamps;
- Scout output, Explorer candidates, Critic evaluations, and Strategist evaluations;
- model, provider, generation ID, token usage, duration, actual cost, and estimated cost per call;
- ranked final briefs;
- the encrypted OpenRouter credential and its non-sensitive display hint.

There is no vector database, agent memory, autonomous loop, social integration, or publishing path in V1.

## Scoring and human control

Strategist supplies six component scores. The orchestrator calculates the final score with the required weights: strategic fit 25%, audience relevance 20%, credibility 20%, conversation potential 15%, originality 10%, and memorability 10%. It then subtracts explicit penalties for genericness, hype, weak evidence, repetition, and weak Axelyn connection. The coefficients live in `src/domain/scoring.ts` for calibration.

The final output remains an editorial decision aid containing claims, reader value, Axelyn's right to speak, counterarguments, evidence needs, and platform direction—not finished posts. Only a human operator decides what is published.
