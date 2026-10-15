# Render Production Setup

Deploy manually as a Node **Web Service**, not a Static Site. The application uses server routes, authentication, manual writes and RAG calls. No Render deployment was executed during release verification.

## Commands

- Branch: `main`, only after the release PR and required CI pass.
- Root directory: repository root.
- Build command: `npm ci && npm run build` (Render's Linux shell).
- Start command: `npm run start -- --hostname 0.0.0.0 --port $PORT`.
- Node: set `NODE_VERSION=24.18.0`, the locally verified runtime; CI uses Node 24. Pin the version rather than relying on a service's historical Render default.
- Set `NODE_ENV=production`. Do not use `next dev`, local preload launchers, test slots or ledger admissions.

## Environment Names

Required at build/runtime:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` for the server admin client. Use the service-role key when running indexing paths that require that exact name.
- `OPENAI_API_KEY`

Optional, according to enabled features:

- `AUTH_SESSION_POLICY_SECRET`: a separate server secret; otherwise the existing admin key fallback is used.
- `RAG_INDEXING_SECRET`: only for the protected external indexing webhook/upload contract.
- `RAG_RECIPE_SUPPORT_STORAGE`: only enable after the matching DB storage contract is available.

Never expose server keys through a `NEXT_PUBLIC_` variable. Do not copy `.env.local` into Git. Configure secrets in Render. Do not set `ILITDA_MANUAL_*`, trial preload `NODE_OPTIONS`, diagnostic execution paths or local-test bypass flags on Render. Existing Supabase migrations and the manual write contract must already be present; do not reset production data or run development seeding on startup.

## Login and Redirects

The public login page is `https://<service>.onrender.com/`, or the HTTPS custom domain. Role-specific entry pages are `/hq`, `/boss` and `/staff` after normal login.

In Supabase Authentication URL Configuration:

1. Set **Site URL** to the final HTTPS public origin.
2. Allow the exact `https://<public-host>/auth/callback` redirect URL, plus any deliberately supported password-reset redirect route from the application.
3. If using a custom domain, configure the corresponding HTTPS callback. Keep localhost callbacks only for intentionally supported development environments.
4. Configure each enabled OAuth provider's Supabase callback and permitted app origin. Do not invent a production mailbox/domain mapping or bypass email verification.

The app derives redirect origins from the incoming request in its normal auth routes; no additional hardcoded local login URL is required. Verify cookies and redirects on the chosen public origin after deployment.

## Manual Acceptance Checklist

After the user deploys, verify login with an existing approved account, tenant/store selection, upload preview/confirm, approval and child `ready`, normal saved chat responses, insufficient-question owner alerts, and a source update followed by a new answer. Use standard application routes only. Usage logs are non-blocking; missing provider usage is marked unknown rather than fabricated. Actual provider 401/429 errors are reported separately from semantic verification failures.

References: Render's Node version and Next.js deployment guides were consulted. This document contains configuration names and commands, not any secret values or personal execution records.