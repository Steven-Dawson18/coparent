# Security baseline

CoParent handles child, health, family, communication, financial, and potentially
legal data. No development or test environment may contain real family data.

## Phase 0 invariants

- Domain records belong to a family, not an individual parent.
- Every family read is scoped through an authenticated membership.
- Writes require an `OWNER` or `PARENT` membership. Professional access is read-only.
- A missing record and an inaccessible record both return `404` to reduce enumeration.
- Security-relevant state changes and their audit event share one database transaction.
- Audit events cannot be updated or deleted by the application.
- PostgreSQL row-level security independently enforces family membership.
- Runtime database credentials do not own schema and cannot bypass RLS.
- DTO validation rejects unknown fields.
- Secrets are loaded from the environment and never committed.
- Invitation tokens are high-entropy, single-use, expire after seven days, and are stored only as hashes.
- Invitation resolution requires an authenticated account whose normalized email matches the invitation.
- Email outbox secrets are encrypted with AES-256-GCM and never logged or stored as plaintext.
- Resend webhooks are signature verified before delivery state is changed.

## Phase 1 invitation boundary

Family owners may invite parents or read-only professionals. Acceptance is a
database function that locks and validates the invitation, creates membership,
marks the token used, and appends the audit event atomically. Invalid, expired,
wrong-account, revoked, and replayed tokens all receive the same not-found result.
The invitation token must never appear in application logs or URL query strings.

## Not production-ready yet

Local password/JWT authentication is development-only. The production OIDC boundary
is implemented, but production still requires a selected identity provider with
MFA/passkeys, recovery controls, session/device management, revocation, and identity
audit logs. It also requires encrypted private document storage,
malware scanning, key management, backup/restore testing, monitoring, a retention
schedule, DPIA, and specialist UK legal/data-protection review.
Production invitation delivery and account-email verification are also required;
the current local flow returns the invitation token once to support development.

Report suspected vulnerabilities privately to the project owner. Do not include
personal data, credentials, tokens, or exploit data from real users in an issue.
