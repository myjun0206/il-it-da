# Render Production Setup

Deploy as a Node **Web Service**, not a Static Site. The application uses server routes, authentication, manual writes and RAG calls. See the root [README](../README.md) and secret-free [.env.example](../.env.example) for setup prerequisites. Do not confuse a Live deployment with working provider authentication or quota.

## Observed Deployment Status

As of the latest recorded check on 2026-10-15, the main deployment was Live. Correcting an environment authentication problem changed the observed embedding response from HTTP 401 to HTTP 429 (`PROVIDER_RATE_LIMITED`). Billing/credit exhaustion versus transient rate limiting remains unconfirmed; the deployed fresh-AI workflow is not yet verified successful. No repeated paid probes were used to hide the failure. Existing-account local workflows passed separately and do not establish Render AI success.

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
- `SUPABASE_SERVICE_ROLE_KEY` for the complete manual-indexing workflow. `SUPABASE_SECRET_KEY` is only a fallback for some admin clients, not every indexing path.
- `OPENAI_API_KEY`

Optional, according to enabled features:

- `AUTH_SESSION_POLICY_SECRET`: a separate server secret; otherwise the existing admin key fallback is used.
- `RAG_INDEXING_SECRET`: only for the protected external indexing webhook/upload contract.
- `WEBHOOK_SECRET`: separately protects `/api/webhooks/index-manual`; it is not the `RAG_INDEXING_SECRET` variable.
- `RAG_RECIPE_SUPPORT_STORAGE`: only enable after the matching DB storage contract is available.
- `NEXT_PUBLIC_NAVER_MAP_KEY_ID` (preferred) or `NEXT_PUBLIC_NAVER_MAP_CLIENT_ID`: build-time public Maps key. Enable current NCP Web Dynamic Map and register the deployed site's Web Service URL in its console.
- `NAVER_SEARCH_CLIENT_ID`, `NAVER_SEARCH_CLIENT_SECRET`: server-only NAVER API HUB local/place search credentials when external store lookup is needed. The unused Maps secret is not a substitute.
- `OWNER_STAFF_EMAIL_OTP_READY`, `OWNER_STAFF_EMAIL_FIRST_OTP_POLICY_READY`: server-side new-signup readiness gates, enabled only after migrations 038/039 and Supabase email/SMTP settings are verified.
- `NEXT_PUBLIC_SIGNUP_EMAIL_OTP_LENGTH`: build-time public new-signup policy; the current supported policy is six digits.

Existing approved users can log in without enabling new-signup readiness gates. The legacy HQ send-verification endpoint deliberately returns 503 in production because its mail sender is not integrated; adding SMTP variables to Render does not implement that path. Never turn on development to bypass this restriction.

Never expose server keys through a `NEXT_PUBLIC_` variable. Do not copy `.env.local` into Git. Configure secrets in Render. Do not set `ILITDA_MANUAL_*`, trial preload `NODE_OPTIONS`, diagnostic execution paths or local-test bypass flags on Render. Existing Supabase migrations and the manual write contract must already be present; do not reset production data or run development seeding on startup.

## Login and Redirects

The public login page is `https://<service>.onrender.com/`, or the HTTPS custom domain. Role-specific entry pages are `/hq`, `/boss` and `/staff` after normal login.

In Supabase Authentication URL Configuration:

1. Set **Site URL** to the final HTTPS public origin.
2. Allow the exact `https://<public-host>/auth/callback` redirect URL, plus any deliberately supported password-reset redirect route from the application.
3. If using a custom domain, configure the corresponding HTTPS callback. Keep localhost callbacks only for intentionally supported development environments.
4. Configure each enabled OAuth provider's Supabase callback and permitted app origin. Do not invent a production mailbox/domain mapping or bypass email verification.

The app derives redirect origins from the incoming request in its normal auth routes; `NEXT_PUBLIC_SITE_URL` is not read by the current main code. Keep `NEXT_PUBLIC_SUPABASE_URL` pointing to Supabase, not Render. Verify cookies and redirects on the chosen public origin after deployment. Completely fresh database/account provisioning and actual restore INSERT were not verified by the recorded deployment checks.

## Manual Acceptance Checklist

After the user deploys, verify login with an existing approved account, tenant/store selection, upload preview/confirm, approval and child `ready`, normal saved chat responses, insufficient-question owner alerts, and a source update followed by a new answer. Use standard application routes only. Usage logs are non-blocking; missing provider usage is marked unknown rather than fabricated. Actual provider 401/429 errors are reported separately from semantic verification failures.

References: Render's Node version and Next.js deployment guides were consulted. This document contains configuration names and commands, not any secret values or personal execution records.