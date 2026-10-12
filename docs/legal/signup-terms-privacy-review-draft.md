# Owner/Staff Signup Terms and Privacy Review Draft

**Status: internal review draft, not a final policy or legal approval.** The screen copy is sourced from `lib/auth/signup-terms-content.ts`. Do not publish as final until the operator decisions below are resolved and legal review is complete.

## Current Flow and Consent Storage

- Local signup refinement adds optional "서비스 개선을 위한 선택 설문·인터뷰 참여 안내 수신 동의" separately from required signupTerms. Auth metadata stores latest choice/version/server timestamp; settings allows withdrawal, but no invitation delivery exists. The yellow screen banner is removed; legal/operator review remains pending. See `docs/signup-consent-resume-cleanup-handover-20261009.md` for scope, retention caveats and actual/mocked evidence.
- `/signup/terms` presents the service terms, personal-information collection/use consent, and one role-specific store consent. The server checks `service`, `privacy`, and `store_connection` for owners or `store_work` for staff before account completion and again before initial store membership creation.
- `signupTerms` is first held in `sessionStorage`, then written as booleans in Supabase Auth `user_metadata`. The flow has no document version, acceptance timestamp, display-language, or durable consent event. Auth user metadata is not an immutable consent audit record.
- A separate privacy policy is informational, not a second checkbox. The previous marketing checkbox remains absent. The new optional research-invitation choice is not a claim that marketing/research delivery is operational and does not cover collection of interview responses or recordings.
- The exact operator/contracting entity, public support contact, retention periods, Supabase project region, configured SMTP provider, and vendor contract terms are not established by this repository.

## A. Service Terms Draft

The signup document covers service purpose and HQ/owner/staff roles; account information and Supabase Auth credentials; store application, review, approval and access restrictions; role-scoped manuals; duties around accuracy, permissions and intellectual property; evidence-grounded AI answers and manager escalation when evidence is insufficient; prohibited conduct and a proposed notice/suspension process; service changes, interruptions and account withdrawal.

The current implementation has HQ/owner/staff routes, manual create/edit/approval paths, staff read paths, AI answers with source/evidence statuses, insufficient-evidence escalation, and role/approved-membership server guards. It does not implement a user-facing appeal workflow or a general suspension console. The restriction/notice/appeal process in the screen draft is a proposed operating rule and must be approved or narrowed before publication. No fees, refunds, guaranteed support channel, or unimplemented withdrawal capability is promised.

## B. Privacy Policy Draft

The screen draft distinguishes this notice from consent and describes these code-observed categories:

| Category | Observed fields/content | Code-observed purpose |
| --- | --- | --- |
| Account/authentication | Email, Auth user ID, confirmation/auth status, role and `signupTerms` metadata; name and phone metadata | OTP, login, account/role setup, profile display |
| Profile | Email, full name, phone, role, approval state, brand/store references; avatar URL | Profile display and role/approval administration |
| Store membership | User ID, store ID, role, request/approval status and related timestamps | Application, owner/HQ review, approved store access |
| Staff conversations | User ID, store ID, title; message role/content, answer status, sources and similarity | Conversation history and staff service |
| RAG question logs | Question, answer, similarity score, answer status, source manual and store reference | Answer history, escalation and service quality/operations |
| Notifications | Recipient ID, type, title, message, target URL, read state and timestamps | Approval, notices, manual and question events |
| Manuals | Title, body, category, status, store/brand scope and derived chunks/embeddings | Manual authoring, approval, search and grounded answers |
| Profile images | JPEG/PNG/WebP image up to 5 MB and avatar URL | Profile display; code uses a Supabase Storage public-URL API, while actual bucket policy still needs verification |
| Operational records | Safe error codes/stages and some request/record identifiers; selected logs include status/counts rather than question text | Diagnostics and service operation; hosting/platform logs and retention are outside this source audit |

Supabase SDK/Auth/DB/Storage use is present in code. The app sends RAG questions and selected manual evidence to OpenAI Chat Completions; question text and manual chunks are also sent to OpenAI Embeddings for search/indexing. Supabase Auth sends OTP requests, but the SMTP provider is configured outside this repository. No code confirms Google SMTP. Vendor role (processor/other), subprocessors, processing country, retention, training/use settings, and contractual safeguards require project/vendor contract review. Calling a service API alone does not establish the legal classification as third-party provision or entrusted processing.

### Account Withdrawal and Retention Observed in Code

The code does not establish per-category retention periods. The staff withdrawal route deletes the Auth user and cascades profile, membership, conversation, message and notification rows, but explicitly preserves question logs, manuals, stores and notices. The owner withdrawal route transfers store/manual ownership to a preservation account before deleting the Auth user; it also attempts avatar cleanup. Therefore, “all data is immediately deleted on withdrawal” would be inaccurate. The timing and legal/operational basis for retained questions, audit references, manuals, backups and logs must be decided and published by data category.

## C. Personal Information Collection/Use Consent Draft

The required consent covers email, name, phone and signup role for authentication, account/profile administration and service access. At the later store-application step it covers the selected store/brand identifier and application/approval state needed to route and process that request. Refusal blocks signup for the minimum account fields and blocks store application for store-specific processing. Generated questions, answers, notifications, uploaded manuals and avatar processing are described separately in the privacy policy; this consent does not silently add marketing or an unrelated purpose.

The screen consent key `privacy` is retained for compatibility but its visible title now identifies this C document. The read-only B policy notice is not submitted as a required consent boolean.

## Consent Evidence Schema Proposal (Not Applied)

Current consent storage is user-editable Auth metadata booleans without versions or timestamps. If the operator needs durable, version-specific evidence, use an append-only consent-event table written by the server after accepted consent, with `user_id`, role, document key, document version, accepted timestamp and signup flow/request reference. Record only affirmative consent and the version actually displayed. Do not record the privacy notice as a consent event. A migration sketch is in `docs/sql/signup-consent-versioning.draft.sql`; it is deliberately not deployed. Retention, deletion behavior and legal basis for keeping this evidence after Auth deletion must be resolved before the draft can be finalized.

## Operator Decisions Required Before Publication

1. Confirm the contracting/privacy-controller legal name, business address, privacy officer/contact department, public email/phone or request channel. Do not substitute an existing Gmail SMTP sender address without authorization.
2. Set the effective date, document versioning, how and how far in advance material terms/privacy changes are announced, and how renewed consent is collected when required.
3. Set data-specific retention/deletion periods and applicable statutory exceptions for accounts, memberships/approval records, question and conversation content, notifications, manuals, avatars, diagnostic logs, backups and the transferred owner-preservation account.
4. Verify Supabase project region, Auth/DB/Storage contracts, subprocessor list, deletion/backups behavior and cross-border processing disclosures.
5. Verify the configured Auth SMTP provider, recipient fields/content, processing location and contract. Google SMTP is not established by application code.
6. Review OpenAI API terms/DPA, model/data-use settings, processing locations, retention and subprocessor conditions for question text, retrieved manual content and embeddings. Decide the legal relationship and disclosures; do not infer it from API calls.
7. Confirm whether the `avatars` bucket is public in the active project. Either disclose the public-URL exposure accurately or change the product/security design in a separately approved task before relying on a private-image statement.
8. Approve the proposed abuse restriction, notice, review and appeal process. Current routes enforce role/approval server-side but do not expose a general suspension/appeal UI.
9. Confirm whether service-generated email, notice, question logs and any external analytics/hosting logs collect additional fields or have different retention. No marketing delivery feature was found in this repository; keep marketing consent absent until one is implemented and separately reviewed.
10. Review whether age limits, guardian handling or role eligibility need to be stated; they are not established by this code audit.

## Official References Consulted

- [Personal Information Protection Act, National Law Information Center](https://www.law.go.kr/법령/개인정보보호법), current version shown as effective 2026-09-11. Relevant provisions include collection/use and notice (Articles 15–16), third-party provision (17), destruction (21), separate consent matters (22), entrusted processing (26), overseas transfer (28-8), privacy policy (30), and data-subject rights (35–37).
- [Terms and Conditions Regulation Act, National Law Information Center](https://www.law.go.kr/법령/약관의규제에관한법률), current version shown as effective 2024-08-07. Relevant provisions include clear Korean drafting/important-term explanation (Article 3), unfair clauses (6), prohibited blanket liability exclusions (7), and termination clauses (9).
- [Personal Information Protection Commission: data-subject access and breach reporting guidance](https://www.pipc.go.kr/np/default/page.do?mCode=D030010000). The official site lists the privacy infringement reporting center at 118 and the Personal Information Dispute Mediation Committee as a public resource; neither is the product's own customer-support contact.

This review is a code-grounded drafting aid, not legal advice or final legal approval. Re-check the effective statutes and vendor contracts before publishing.
