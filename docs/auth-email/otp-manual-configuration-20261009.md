# Email-First OTP: Manual Supabase Configuration

## Status and Cause

Prepared locally, NOT applied. No automated mail send, Auth/SMTP edit, account deletion, 039 migration edit/reapply, 040 application or commit/push occurs.

Current owner/staff start and resend use createEphemeralAuthClient().signInWithOtp. New signup uses shouldCreateUser=true and metadata role plus signup_flow=email_first; resume/resend uses shouldCreateUser=false without changing credentials/role. The SDK method name does not force a code email: Magic Link is the default presentation unless the template contains .Token. "Your sign-in link" is the provider's default Magic Link subject, consistent with the reported resend email; actual delivered bodies/settings were not inspected or changed here.

Known source values: EMAIL_FIRST_OTP_LENGTH=6, server flow window=180 seconds after successful `sent` acknowledgement, and 039 cooldown=60 seconds. Shared Auth token length/expiration and deployed template contents are separate settings and remain operator-verification items. Adding a 3-minute sentence in HTML does not change provider expiry.

## Location, Subjects and Exact HTML

Project: `ixudarcrzcvhugjuyhuz`. In Supabase Dashboard, open Authentication > Email > Templates (or Authentication > Email Templates), then the two templates below. Current hosted dashboard URLs use `/auth/templates` and Magic Link/OTP `/auth/templates/magic-link-or-otp`.

| Template | Subject (plain text) | Complete HTML source |
| --- | --- | --- |
| Confirm sign up | `[일잇다] 이메일 인증 안내` | `docs/auth-email/confirm-signup-otp.manual.html` |
| Magic Link / OTP | `[일잇다] 이메일 인증 안내` | `docs/auth-email/magic-link-otp.manual.html` |

Review/save each subject and entire HTML manually. Both documents are ready to paste as Go templates: .Token is rendered only for signup_flow=email_first; the else branch retains .ConfirmationURL for non-email-first consumers. Keep the Go conditional and both branches. Do not substitute actual tokens, user credentials or project secrets into the files. Before changing a shared template, retain its current provider-config copy privately for operator rollback.

Magic Link MUST be checked for existing-user resend/resume. Confirm sign up must also be checked because new-user/confirmation mail paths can use it depending on deployed Auth behavior/version. Do not assume one template alone covers new and existing accounts. Confirm dispatch with a dedicated manually operated test mailbox only after the operator authorizes sends; this task does not send one.

## Token and Timing Settings

In Authentication > Sign In / Providers > Auth Providers > Email, verify email OTP length is 6 and Email OTP expiration is 180 seconds, email provider is enabled and Confirm email is ON (auto-confirm OFF). Labels can vary by dashboard version; use the equivalent hosted Email provider settings. Keep provider rate limits/cooldown intact. Do not disable confirmation to work around the screen.

The project-wide Email OTP Expiration also governs Magic Links and other email verification links, including confirmation, recovery, email change and invitations per Supabase documentation. Setting it to 180 seconds shortens those paths too. Obtain operator approval and manually test those existing paths before changing the setting. If other paths need longer lifetime, keep the server's local three-minute signup gate and report the provider-window mismatch instead of silently changing shared expiry or claiming provider tokens expired after exactly three minutes.

## Existing Paths and Limits

- Normal HQ signup uses the server signup service/admin createUser with email_confirm=true, after the separate HQ verification path; it does not use this passwordless start/resend function. Its app verification flow and SMTP sender are not replaced.
- The actual HQ `/api/auth/send-verification` route is development-only: it creates a six-digit code with five-minute email_verifications expiry and currently logs the development code. In non-development it fails closed with 503 because a delivery service is not connected. This task does not call or rewrite that endpoint, create its sender, expose real codes or promise HQ delivery is operating. Supabase template updates do not implement that separate path; its production readiness/log policy needs separate review.
- Password login remains signInWithPassword and OAuth remains the existing provider flow; no sender is added.
- Legacy signUp confirmations or other passwordless consumers can share these templates. The else link avoids converting them to a code-only email without an input screen. Exact previous custom wording/layout may need preservation by the operator.
- New and current email-first accounts carry signup_flow metadata. A legacy account without the marker goes to the link fallback; do not update Auth metadata wholesale to force it into signup flow.
- Metadata is account-scoped, not request-scoped. If another passwordless consumer sends to an account retaining the email_first marker, it receives the OTP branch too. These shared templates cannot guarantee independent per-route presentation. This repository's known passwordless call is the signup helper, but external/new consumers need explicit compatibility review before template deployment.
- Link-prefetch scanners can consume confirmation links. The email-first branch has no confirmation link, only the OTP text. This does not waive email security/rate controls.

## Wrong Code, Expiration and Server Evidence

- CODE_INVALID: "인증번호가 틀립니다. 다시 확인해 주세요."; CODE_EXPIRED: "인증 시간이 만료되었습니다. 새 인증번호를 받아주세요.".
- Local server deadline already expired: refuse before provider verification. Rate limit/network/Auth outage remain separate; unknown verify 4xx is not guessed as wrong OTP.
- Some provider failures use otp_expired plus "Token has expired or is invalid" for both wrong and expired values. Within the same current request/user and live server deadline, the app labels this as CODE_INVALID; after the deadline it labels CODE_EXPIRED. A changed request/identity is rejected as such.
- This is application-window evidence, NOT proof of the provider's internal cause. A provider TTL shorter than 180 seconds, superseded/consumed code or settings mismatch may look like an invalid code inside the app window. Manually verify actual provider length/expiry and latest email; never claim the error message alone proved expiration/mismatch.
- Failure retains OTP and other fields/deadline and does not authenticate. Resend clears code/error only after success with a valid server deadline. A provider error/429 preserves deadline; cooldown from Retry-After remains enforced; busy guard blocks duplicate requests.

## Manual Acceptance After Approved Settings

1. Fresh owner email: manually request once, verify received subject and a 6-digit code (no signup login link), record issued server deadline without logging the OTP itself.
2. Submit a deliberately different six-digit value before deadline: exact wrong-code text appears below OTP; fields and deadline remain; no verified state appears.
3. Request resend when cooldown allows: manually check latest mailbox template/code, deadline refreshes only on success and previous input/error clear. Fail/limit paths must retain old deadline and enforce cooldown.
4. Wait beyond 180 seconds: expiration message is distinct and verification is blocked; manually request a new code when allowed.
5. Repeat staff. Verify required-only/all selection and optional refusal do not affect OTP/mandatory server validation.
6. Verify HQ separate email verification, password login, OAuth and any existing confirmation/recovery/passwordless links under the shared provider setting. Do not treat mocked UI tests as delivered-mail verification.

## Official References

- https://supabase.com/docs/guides/auth/auth-email-passwordless (OTP/Magic Link share implementation; .Token and expiration settings)
- https://supabase.com/docs/guides/auth/auth-email-templates (Go variables/conditional templates and default Magic Link subject)