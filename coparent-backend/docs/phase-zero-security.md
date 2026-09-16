# Phase 0 security architecture

## Database identities

Production uses three distinct identities:

1. A platform administrator creates the database and the non-login
   `coparent_runtime` role.
2. A migration identity owns the schema, applies reviewed migrations, and is not
   available to the running API.
3. A runtime login inherits `coparent_runtime`, cannot create or alter schema,
   and receives only the table operations required by the API.

The migration contains role creation for a new development database. On a
managed PostgreSQL service where application migrations cannot create roles, an
administrator must create `coparent_runtime` before deployment and the role
creation block should be marked as already applied through the platform's
reviewed migration process.

Never give the runtime login `SUPERUSER`, `BYPASSRLS`, `CREATEROLE`, schema
ownership, or membership in the migration role.

## Row-level security

The API runs every family-sensitive operation inside a database transaction and
sets `app.current_user_id` with PostgreSQL `set_config(..., true)`. The final
argument makes the value transaction-local, preventing identity leakage when a
pooled connection is reused.

Policies enforce:

- Members can read only their families, memberships, children, and audit events.
- `OWNER` and `PARENT` can write family data.
- `PROFESSIONAL_READ_ONLY` can read but cannot write.
- Users can read their own account and accounts sharing a family.
- Audit events can be inserted for the current actor but cannot be updated or
  deleted.

Application filters remain in place as the first authorization layer. RLS is the
independent database layer.

## Identity modes

`AUTH_MODE=local` exists for development. It enables local registration, bcrypt
password verification, and short-lived HS256 access tokens.

Production should use `AUTH_MODE=oidc`. In this mode:

- local registration and login endpoints return `404`;
- access tokens must use RS256;
- signature keys come from the configured HTTPS JWKS endpoint;
- issuer and audience must exactly match configured values;
- JWKS retrieval is cached and rate-limited;
- the verified issuer/subject pair must already exist in `ExternalIdentity`;
- unknown external subjects are denied and never silently provisioned.

Identity-provider selection, MFA/passkey policy, recovery controls, identity
proofing, and the invitation/provisioning workflow remain explicit product and
legal decisions.

## Integration verification

`npm run test:rls` creates a unique temporary PostgreSQL cluster and database,
applies migrations, creates a restricted runtime login, and verifies cross-family
denial, professional read-only access, transaction-context cleanup, and audit
immutability. The cluster is stopped and deleted afterward.

The test requires either Postgres.app at its default location or `PG_BIN` pointing
to PostgreSQL binaries. It cannot run inside environments that block PostgreSQL
shared-memory system calls.

## Phase 1 invitation workflow

Invitation records are visible only to the owning family owner under RLS. The
bearer token is generated from 32 cryptographically random bytes and only its
SHA-256 digest is persisted. Pending invitations are unique per normalized email
and family, expire after seven days, and can be revoked by the owner.

Invitation resolution functions pin their PostgreSQL session timezone to UTC.
This prevents host-local timezone settings from making a UTC JavaScript expiry
appear prematurely expired in a PostgreSQL `timestamp` comparison.

Acceptance and decline use narrowly granted `SECURITY DEFINER` functions. They
bind the token to the authenticated account's normalized email while holding a
row lock. Acceptance updates the invitation, creates membership, and appends its
audit event in one transaction. Replay, expiry, wrong-account use, and unknown
tokens return no row, which the API consistently maps to `404`.

## Invitation email outbox

Invitation creation, audit insertion, and encrypted email enqueueing occur in one
database transaction. The outbox payload uses AES-256-GCM with a fresh 96-bit IV
and authentication tag per message. Only narrowly granted security-definer
functions can enqueue, claim, complete, retry, or record provider events; the
runtime role has no direct table access.

The worker uses row locks with `SKIP LOCKED`, five bounded attempts, exponential
backoff, stale-lock recovery, and provider idempotency keys. Revoked, accepted,
declined, or expired invitations are never delivered. Provider errors are stored
only as short classifications, never raw responses that might contain personal
data. Resend webhook signatures are verified against the raw request body.
Encrypted token fields are erased after successful delivery or terminal failure.
