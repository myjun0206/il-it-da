# Social Auth: Evidence and Manual Acceptance

Status: local uncommitted fixes, not live-login certification. Original checkout, develop `771a88cca0cab253a26519e94e7fe008d284b0ac`, app `http://localhost:3000`, hosted project `ixudarcrzcvhugjuyhuz`. No provider configuration, SMTP, account deletion, shared SQL installation or publication was performed.

## Current Scope (2026-10-09)

The user confirmed 040 application and actual Auth permanent-delete/same-email signup success. Historical residual 039 cleanup was also completed with candidate array `[]`. Do not reapply either SQL or delete more accounts. These are user-operated results; the no-mutation statement above describes agent actions.

Focus only on social-login failures. Correlate each provider's supplied error screen, request timestamp, HTTP status/safe code and redacted server log across provider authentication -> hosted callback -> app callback -> verified server session -> profile/approval routing. The user now reports Naver's development-mode registered-account restriction and Kakao KOE205. These identify provider-stage blockers, not proof of a downstream callback defect or a working session. No timestamp-matched server logs have been supplied. Start API HTTP 200 is not login success. Preserve email signup, access controls, env and stash; no commit/push or external settings changes.

## Naver Restriction and Kakao KOE205

Naver: the reported screen says only registered IDs can log in while the application is in development. Current integration is Supabase `custom:naver` OIDC, not a direct app-owned Naver OAuth2 token exchange. Do not replace the OIDC flow, disable PKCE/state/nonce, or patch the app callback to bypass a provider tester restriction.

Operator procedure: sign in as the Naver application owner/admin, open Application -> My Applications -> the application whose Client ID matches Supabase Authentication -> Sign In / Providers -> Custom OAuth Providers -> `custom:naver`. Compare IDs privately, never publish them. Open Member Management -> Tester ID Registration, register the exact Naver login ID (not the app's email/UUID), confirm it appears in the tester list, then retry from a new private browser context using that account. Official documentation lists a maximum of 20 tester IDs. Do not grant administrator privileges just to permit testing. If the account is already registered, check selected application, signed-in Naver identity and persistence of the registration. General-public login requires Naver inspection approval; that is not performed by this work.

Naver API Settings -> PC/Mobile Web -> Naver Login Callback URL must match the actual custom provider's hosted callback. This project uses `https://ixudarcrzcvhugjuyhuz.supabase.co/auth/v1/callback`; the final localhost app redirect is separate. [Official tester/account management](https://developers.naver.com/docs/common/openapiguide/appconf.md) and [OIDC guide](https://developers.naver.com/docs/login/devguide/devguide.md) support this distinction.

Kakao: KOE205 is an authorization-code `invalid_scope` error: at least one requested consent item is not configured for the Kakao app. It is not KOE006 redirect mismatch or KOE010 token client-secret failure. The exact offending scope is not known until the error's `SCOPE_ID` and the console settings are compared.

Observed current path: app start HTTP 200 -> hosted Supabase `/auth/v1/authorize` HTTP 302 -> Location pointing to `kauth.kakao.com/oauth/authorize`. Only the outgoing redirect was inspected; the provider URL was not followed, credentials were not entered, and no provider settings/account data were changed. The decoded `scope` was exactly `account_email profile_image profile_nickname`; `redirect_uri` matched the hosted callback. The app supplied no scope override. It is Supabase's built-in Kakao path, not the alternative Kakao JS/OIDC ID-token flow. `openid` was not requested in this inspected redirect.

| Requested scope | Kakao consent item to compare | Action before any change |
| --- | --- | --- |
| account_email | Kakao account email | Check enabled/allowed consent level and app permission/Biz App requirements; do not remove email to suppress the error |
| profile_image | Profile photo | Check the separate photo consent item; nickname enablement does not imply photo enablement |
| profile_nickname | Nickname | Check the separate nickname consent item, including legacy combined-profile configuration |

Operator console: Kakao Developers -> App -> the app matching the REST API key configured in Supabase Kakao -> Kakao Login -> Consent Items (some navigation versions prefix Product Settings). Record each item's ID, enabled state, consent level and whether permission is unavailable. Read KOE205's "unconfigured consent item" list. If a requested item is required, an authorized operator must resolve its permission/configuration; optional/unneeded scope changes require a separate product review. This patch does not silently narrow scopes or change email-optional settings.

Provider callback setting: App -> Platform Key -> REST API Key -> Kakao Login Redirect URI, using `https://ixudarcrzcvhugjuyhuz.supabase.co/auth/v1/callback`. Supabase Authentication -> URL Configuration separately allows `http://localhost:3000/auth/callback`. Changing callback URLs is not the identified fix for KOE205. [Kakao error reference](https://developers.kakao.com/docs/ko/kakaologin/trouble-shooting) and [Supabase Kakao setup](https://supabase.com/docs/guides/auth/social-login/auth-kakao) are the official references.

Stage acceptance remains sequential: provider authorization success -> hosted Supabase callback/code exchange -> app callback PKCE exchange -> server `getUser` identity -> profile/onboarding/pending/approved app routing. Error callbacks can return without successful authentication. Neither reported provider blocker verifies the later stages or rules out later independent defects. Collect redacted stage/status/code and timestamps; do not share full authorize/callback URLs, cookies, state, code or tokens.

No unnecessary app-scope request was found, so production code and team UI remain unchanged. The focused route regression now asserts only `redirectTo`/`skipBrowserRedirect` are passed even if client JSON injects scopes/queryParams; callback/onboarding regressions pass 8/8 with synthetic mocks. These tests are not live login certification. 040 and completed 039 cleanup remain out of scope.

## Observed Stages

| Provider | Button/start path | Read-only configuration evidence | Actual provider login/callback |
| --- | --- | --- | --- |
| Google | POST `/api/auth/oauth`, provider `google`: HTTP 200, authorize URL returned | Public Auth settings: enabled=true | User operated only; not certified by these probes |
| Naver | Same app endpoint, `custom:naver`: HTTP 200 | Admin custom-provider GET: OIDC, enabled=true, issuer `https://nid.naver.com`, scopes `openid/profile`, PKCE=true, email_optional=true | User reports development-mode registered-account restriction; provider-stage blocker |
| Kakao | Same app endpoint, `kakao`: HTTP 200; Supabase authorize HTTP 302 | Public Auth settings: enabled=true; outgoing scopes account_email/profile_image/profile_nickname | User reports KOE205; exact unconfigured scope ID still needed |
| Apple | Same app endpoint, `apple`: HTTP 200 | Public Auth settings: enabled=true | Actual error stage/code not supplied |

These start probes did not follow external authorize URLs or submit provider credentials. HTTP 200 at app start is not proof of Supabase authorize/provider consent/token exchange success. Local Naver env-key absence is not a configuration diagnosis: credentials are hosted in Supabase.

Naver's public discovery GET returned HTTP 200 and valid OIDC metadata: authorization `/oauth2/authorize`, token `/oauth2/token`, userinfo `openapi.naver.com/v1/nid/me`, JWKS `/oauth2/jwks`, S256 PKCE and `client_secret_post/none` authentication. Email is not advertised in its claims. Do not replace this with the older `/oauth2.0` OAuth2 example solely because Naver is absent from Supabase's built-in provider list. End-to-end claim extraction/credentials still require a manual login; discovery success does not prove those.

## Local Fixes

Authenticated callback reads profiles through the server Admin client only after `auth.getUser`, scoped to that verified user ID. New social users go to role/terms/profile even if a supplied `next` or editable metadata contains stores. Existing users retain their profile role and approved/pending routing. No role or approval is copied by email.

New social onboarding validates name, phone and role-specific required terms before profile insertion. It stores mandatory consent independently of optional research consent and creates only pending profiles. Existing-role mismatch and concurrent insertion mismatch are rejected. UI forwards selected required terms. Provider-only names are not required or trusted as substitutes for a user's completed form.

Start responses catch failures with safe `code/stage/provider` fields and check the returned URL against this project's Supabase authorize endpoint/provider/final callback. PKCE cookies and signed ten-minute remember-me policy remain. Callback cancellation clears pending policy, and exchange/profile failures use fixed codes. Raw descriptions, authorization URLs, state/code/token values and database error payloads are not logged by these paths. Retries restart OAuth; a failed code exchange is not accepted using a different stale browser identity.

## Manual Provider Checks

The provider-facing return URL is `https://ixudarcrzcvhugjuyhuz.supabase.co/auth/v1/callback`; copy the actual provider panel's callback rather than inventing one. Supabase's app redirect allowlist separately needs exact `http://localhost:3000/auth/callback` and the approved production callback. Do not change settings as part of this code patch.

1. Google: verify Web client, hosted Supabase authorized redirect, consent/testing audience and openid/email/profile access. A working Google login does not certify other provider credentials.
2. Naver: verify the registered `custom:naver` client and OIDC discovery, callback registered in Naver, app inspection/test-user permissions, supported token auth and actual ID-token/userinfo subject extraction. Keep PKCE/state/nonce validation. Capture the immediate next request's HTTP status and safe error code before deciding a config change. Missing email is allowed by the current provider flag, but nullable profile email in the actual catalog must be confirmed. Do not fabricate email or merge by email to bypass this.
3. Kakao: verify REST API key/client secret activation, Kakao Login ON, exact hosted callback and consent items. Email/Biz App requirements and Supabase Allow users without email are a separate policy decision; they are not implied by enabled=true. Do not turn off security or invent an email to make login pass.
4. Apple: verify Services ID is first for web client IDs, Team/Key IDs, signing secret expiry/rotation, domain and HTTPS hosted callback. Apple cannot register a literal localhost/IP/HTTP provider Return URL; a hosted Supabase HTTPS return followed by an allowlisted localhost app redirect is different. Collect name manually; web OAuth/returning authorization need not provide full name. Preserve private relay email as returned and review relay sender-domain requirements without changing SMTP.

For each provider, manually test cancel; first login with/without email/name; return login; reload/back/retry; pending and approved existing accounts; a deliberate role mismatch; and email/password users with a provider identity. Supabase itself may automatically link verified same-email identities. This patch neither configures that policy nor implements Admin linking, custom JWTs or email-based profile/membership merging.

## Acceptance Sequence

1. Use a dedicated browser context/account and click one provider. Record only stage, HTTP status and safe error code: app start -> Supabase authorize -> provider consent -> hosted provider callback -> app callback -> server session -> onboarding -> store request.
2. For a new account, require role, explicit required terms, valid name/phone before profile/application writes. Missing email must produce a supported nullable-email flow or a safe actionable failure, never a fake address. Optional research consent must not gate signup.
3. Confirm pending profile/application and denial of protected store manuals before normal approval. Manually approve using the normal HQ/owner process; re-login and verify only newly approved access.
4. Existing accounts must retain role, approval and membership. Apple relay and returning users must not depend on first-login name metadata. Repeated onboarding must not create duplicate profiles or silently switch roles.
5. Share only fixed codes/HTTP/stage. Never share full callback/authorize URLs, query code/state/token, cookies, credentials or client secrets. Exact Naver/Kakao/Apple live failure causes remain unresolved until this evidence is obtained.

## Verified Locally

Focused route mocks cover four provider starts, hostile redirects, safe initiation failures, verified-ID callback routing, cancellation, social metadata auto-application denial, required onboarding validation and existing-role preservation. They are not real OAuth runs. Isolated SQL tests pass 4/4. Original 3000 mocked signup/terms browser checks pass 15/15 after correcting a temporary callback import compilation error. Auth 326, RAG 1467, RAG evaluation 239, integration 79 and frontend 106 tests pass; app TypeScript passes. Remaining live-provider and actual database acceptance are intentionally manual.

Official references: [Supabase custom providers](https://supabase.com/docs/guides/auth/custom-oauth-providers), [Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [Kakao](https://supabase.com/docs/guides/auth/social-login/auth-kakao), [Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple), [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking), and [Naver login API](https://developers.naver.com/docs/login/api/api.md).