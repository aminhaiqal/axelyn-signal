# Axelyn Signal

Axelyn Signal turns one raw observation into a small, ranked set of editorial briefs. It uses four bounded model calls controlled by application code; agents never chat with each other, keep hidden memory, or publish content.

## Working vertical slice

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

## Run locally

Requirements: Node.js 24+ (the persistence layer uses Node's built-in SQLite module).

```bash
npm install
cp .env.example .env.local
# Add OPENROUTER_API_KEY to .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful checks:

```bash
npm test
npm run lint
npm run build
```

## Configuration

Every agent model can be replaced independently in `.env.local`:

```dotenv
SCOUT_MODEL=google/gemini-2.5-flash-lite
EXPLORER_MODEL=google/gemini-2.5-flash
CRITIC_MODEL=deepseek/deepseek-v3.2
STRATEGIST_MODEL=anthropic/claude-haiku-4.5
```

The defaults deliberately use an inexpensive Scout, a mid-tier creative Explorer, a different model family for Critic, and a balanced Strategist. Model slugs are configuration, not architectural dependencies.

Temperatures and maximum output-token budgets are also independently configurable with the `*_TEMPERATURE` and `*_MAX_OUTPUT_TOKENS` variables shown in `.env.example`.

OpenRouter's returned `usage.cost` is stored when present. Per-token prices in `.env.example` provide a fallback estimate and should be refreshed when model pricing changes.

## Boundaries

- Domain schemas: `src/domain/schemas.ts`
- Deterministic score: `src/domain/scoring.ts`
- Agent/model configuration: `src/config/agents.ts`
- Editable Axelyn context: `src/config/axelyn-context.ts`
- Separate prompts: `src/prompts/`
- OpenRouter gateway: `src/llm/openrouter.ts`
- Pipeline state machine: `src/pipeline/orchestrator.ts`
- SQLite schema/repository: `src/persistence/`
- Streaming API: `src/app/api/pipeline/route.ts`
- Operator UI: `src/components/signal-workspace.tsx`

The V1 Axelyn context is intentionally conservative because no detailed company proof library was supplied. Review `src/config/axelyn-context.ts` before production and replace the working positioning, credible-experience areas, and exclusions with verified company language.

## Persistence

The local database defaults to `.data/axelyn-signal.db` and stores:

- raw signal and optional context;
- pipeline and agent statuses/timestamps;
- Scout output, Explorer candidates, Critic evaluations, and Strategist evaluations;
- model, provider, generation ID, token usage, duration, actual cost, and estimated cost per call;
- ranked final briefs.

Set `AXELYN_DATABASE_PATH` to change the location. V1 assumes a durable Node server; serverless SQLite needs a persistent volume or a hosted database adapter.

## Scoring

Strategist supplies six component scores. The orchestrator calculates the final score with the required weights:

- strategic fit 25%;
- audience relevance 20%;
- credibility 20%;
- conversation potential 15%;
- originality 10%;
- memorability 10%.

It then subtracts explicit severity-weighted penalties for genericness, hype, weak evidence, repetition, and weak Axelyn connection. The coefficients live beside the formula in `src/domain/scoring.ts` for easy calibration.

## Human control

There is no publishing path. The final output is an editorial decision aid containing claims, reader value, Axelyn's right to speak, counterarguments, evidence needs, and platform direction—not finished posts.
