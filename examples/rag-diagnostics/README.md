# Local RAG Diagnostics

This Node-only diagnostic tool is not connected to a public route. Use a recent Node version with native TypeScript support (Node 22.18+ or 24) and the repository dependencies.

## Safe Default

```powershell
node --import ./tests/support/register-alias-hooks.mjs scripts/diagnose-rag.ts --input examples/rag-diagnostics/questions.json
```

Without `--live`, the tool does not load `.env.local`, query Supabase, or call OpenAI. It prints query plans. Optional input fixture matches/generation exercise score and response contracts, not real retrieval quality.

Input shape: `storeId` and `cases: [{ question }]`, with 1-20 cases and at most 2,000 characters per question. The supplied store templates are placeholders. Do not put keys, employee information or cookies in input JSON.

## Explicit Live Mode

Live calls require operator approval. Resolve the selected store ID in the intended project before using a store template. Keep runtime input files local; the committed examples must remain placeholders.

The tool reads the RAG worktree's `.env.local` only in live mode. Required variables are `NEXT_PUBLIC_SUPABASE_URL`, `OPENAI_API_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`. Existing process variables take precedence. `NODE_ENV=development` must be set before execution, not only inside the env file.

```powershell
$env:NODE_ENV = 'development'
node --conditions=react-server --import ./tests/support/register-alias-hooks.mjs scripts/diagnose-rag.ts --input examples/rag-diagnostics/mega-isu.example.json --live
```

Replace the template storeId before executing this command. The live tool resolves franchiseId from `stores.franchise_id`; it does not trust an input franchiseId. It does not replace employee membership testing.

- `--live`: database reads and one paid query embedding per question; no answer-model call.
- `--live --generate`: additionally, at most one existing answer-model call for each admissible question. Local clarification may skip generation.
- No SQL, manual/chunk/embedding persistence, question log or notification writes are performed by this tool.
- Do not execute both modes needlessly: a second execution creates another query embedding and another charge.

## Interpretation

RPC position and `rpcRankScore` describe retrieval order. `evidenceScore` uses raw semantic similarity plus capped keyword support. They are not interchangeable. Selected-source scores and final classification are determined by the existing resolver. Rounded display percentages are not calibrated answer-accuracy probabilities.

The report covers returned candidates only, not all filtered or lower-ranked database rows. Scope metadata, menu exclusions and parent-card warnings help identify a review target; they do not prove the whole database is valid. A search-only report has no generated answer or final source selection. A fixed-score fixture is not evidence of real search improvement.

Credentials are not printed, raw service errors are suppressed, and known secret values are redacted. Only use approved non-personal questions. Do not publish local diagnostic outputs.

## Staff Request Trace

The development server can emit safe stage diagnostics with `RAG_TRACE=1`. Configure the RAG server terminal before starting it. Do not terminate other worktrees' servers.

```powershell
$env:RAG_TRACE = '1'
npm run dev -- --port 3001
```

Trace is disabled in production. Compare hashed conversation tags, effective store, history reason, target augmentation, candidate counts, gate status and final reason. Do not share HAR files, cookies or raw conversation IDs. For reproduction, use one fresh conversation and one controlled two-turn sequence; no separate live CLI call is required. Set `RAG_TRACE=0` before the next restart to disable tracing.