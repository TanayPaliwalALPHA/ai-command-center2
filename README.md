# AI Command Center (MVP)
**Flow:** User → Router (JSON plan) → selected agents run in order, each gets only the outputs listed in its `uses` → Final Reviewer → answer. Streamed to the UI as NDJSON.

**Run:** `npm install && cp .env.example .env.local` (add keys) `&& npm run dev`, open http://localhost:3000. At least one key is required; two or more enable multi-agent workflows.

**Layout:** `lib/providers.ts` (one adapter per AI, retry + timeout) · `lib/orchestrator.ts` (router, context passing, review, step cap) · `app/api/run/route.ts` (streaming endpoint, rate limit, key-safe) · `app/page.tsx` (dashboard).

**Safety/cost:** keys server-side only; mode caps steps (1/3/4/5); max one retry; 45s timeouts; failed agents are reported and the reviewer is told what is missing; the reviewer separates facts from opinions and flags disagreements.

**Roadmap**
- 1.1: SQLite/Postgres (Prisma) for history, auth (NextAuth), token/cost tracking, Markdown rendering, copy/export.
- 1.2: Memory layer (preferences, projects, decisions) with opt-in, redaction and per-item delete; verification step when agents conflict; token streaming.
- 2.0: Provider plugins, parallel steps, file uploads, shared workspaces, evals, budget limits per user, Redis rate limiting.
