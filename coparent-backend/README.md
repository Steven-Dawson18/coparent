# CoParent Backend

> Secure family onboarding and permanent text messaging are implemented. This software is not ready for
> production or real family data. See [SECURITY.md](./SECURITY.md).

## Current baseline

- Node.js 24.19 LTS
- NestJS API with strict DTO validation, security headers and throttling
- PostgreSQL/Prisma family tenancy model
- PostgreSQL row-level security with separate migration/runtime identities
- Authenticated, family-scoped child APIs
- Append-only audit-event database trigger
- Local-development and managed-OIDC authentication modes
- Single-use, seven-day family invitations with hashed bearer tokens
- Atomic invitation acceptance bound to the authenticated account email
- Encrypted transactional email outbox with bounded retries and idempotent delivery
- Immutable, categorized family messages with child context and read receipts

The Phase 0 schema deliberately replaces the prototype schema. Existing local
prototype databases require an explicitly approved reset before applying it; do
not run `prisma migrate reset` if the database contains anything you need.

The development migrations were consolidated on 27 August 2026. Recreate an
older local Docker database before starting this version:

```sh
cd /Users/steve/Documents/node_projects/coparent
docker compose down --volumes --remove-orphans
docker compose up --build --detach
```

```sh
nvm use
npm ci
npx prisma generate
npm test
npm run test:rls
npm run build
```

The RLS test uses a disposable PostgreSQL cluster and never connects to the
configured development database. See `docs/phase-zero-security.md` for the role,
policy, and production identity-provider design.

## Family invitation API

Only a family `OWNER` can create, list, or revoke invitations. Invitation roles
are restricted to `PARENT` and `PROFESSIONAL_READ_ONLY`. Resolution always
requires authentication, and the accepting or declining account email must match
the normalized invited email.

- `POST /families/:familyId/invitations`
- `GET /families/:familyId/invitations`
- `POST /families/:familyId/invitations/:invitationId/revoke`
- `POST /families/:familyId/invitations/:invitationId/resend`
- `POST /invitations/accept`
- `POST /invitations/decline`

In `development` email mode, creation returns the raw token exactly once for
local integration. In `resend` mode it is delivered by email and omitted from
the API response. The invitation table stores only its SHA-256 hash; the
transactional outbox stores an AES-256-GCM encrypted payload until delivery.
Tokens belong in request bodies, not URLs or logs.

## Invitation email delivery

`EMAIL_PROVIDER=development` simulates delivery without logging the recipient or
secret. For Resend, configure `EMAIL_PROVIDER=resend`, a domain-scoped
`RESEND_API_KEY`, `EMAIL_FROM`, and `RESEND_WEBHOOK_SIGNING_SECRET`. Configure the
Resend webhook URL as `POST /webhooks/email/resend`.

Generate the dedicated outbox encryption key with `openssl rand -base64 32`.
Keep it in a secrets manager and never reuse the JWT or database password. The
current key must remain available until every pending/retry job using its
`keyVersion` has completed or been deliberately invalidated.

Invitation creation and outbox insertion share one database transaction. A
worker claims jobs with `FOR UPDATE SKIP LOCKED`, retries transient failures up
to five times with exponential backoff, uses the outbox job ID as Resend's
idempotency key, and records verified delivery/bounce webhook events.

## Permanent messaging API

- `GET /families/:familyId/messages?limit=30&cursor=<messageId>`
- `POST /families/:familyId/messages`
- `POST /families/:familyId/messages/:messageId/read`

Messages are created through an atomic database function that validates family
write access and child links, creates delivery receipts, and appends a
`MESSAGE_SENT` audit event. PostgreSQL triggers prohibit message and child-link
updates or deletes, including through the migration connection. Professionals
may read and acknowledge messages but cannot send them. Messages, requests and
request responses accept up to ten `attachmentIds` from the secure document
service described below. Linking is atomic: documents must be unattached, owned
by the actor, and in the same family. Once linked, both the association and file
content are immutable.

## Secure documents API

- `GET /families/:familyId/documents`
- `POST /families/:familyId/documents` (multipart field `file`)
- `PATCH /families/:familyId/documents/:documentId` (new immutable version)
- `GET /families/:familyId/documents/:documentId/history`
- `GET /families/:familyId/documents/:documentId/download`

Files are limited to 10 MB and an allow-list of PDF, JPEG, PNG, WebP, text and
DOCX. The service verifies file signatures, encrypts each file with AES-256-GCM
before storage, and verifies its authentication tag, size and SHA-256 hash on
download. PostgreSQL contains metadata and immutable version history rather
than file contents. Downloads are authorised through family RLS and appended to
the audit stream. Documents may be associated with children and with an expense
as its receipt.

Set `FILE_STORAGE_ROOT` to a durable private volume and generate a dedicated
`FILE_STORAGE_ENCRYPTION_KEY` using `openssl rand -base64 32`. Never reuse the
JWT, database, or email-outbox secret. Back up the file volume and key together;
losing either makes documents unrecoverable. Production object storage can
replace the local provider through `FileStorageService` without changing the
document API.

## Notifications and reminders API

- `GET /notifications`
- `GET /notifications/unread-count`
- `POST /notifications/:notificationId/read`
- `POST /notifications/read-all`
- `GET /notifications/preferences`
- `PATCH /notifications/preferences`

Messages, requests and expenses generate deduplicated recipient notifications
inside the same database transaction. A background worker creates upcoming
handover and calendar reminders according to each user's lead-time preference.
The retryable email outbox sends only a generic title and directs the user to
sign in; family details, message text and document content are never included in
notification email. Notification identity is immutable, read transitions are
database-controlled, and RLS exposes records only to their recipient.

## Audit and evidence API

- `GET /families/:familyId/audit-events?from=<ISO>&to=<ISO>&action=<ACTION>&entityType=<TYPE>`
- `GET /families/:familyId/evidence-export?from=<ISO>&to=<ISO>&action=<ACTION>&entityType=<TYPE>`

The audit chronology is read-only, family-scoped and cursor paginated. Evidence
exports are restricted to parents and family owners, contain at most 5,000
events, and include a SHA-256 checksum over the export content. The checksum is
an integrity aid rather than a digital signature or a claim that the file is
legally admissible. Read-only professionals can inspect the chronology but
cannot download an evidence file.

## Action-focused dashboard API

- `GET /families/:familyId/dashboard`

The dashboard returns one RLS-scoped snapshot containing current and next living
arrangements, the next seven days of calendar events and handovers, action
counts for the signed-in parent, unread family messages, and balances calculated
from accepted expenses. It stores no duplicate summary data and therefore does
not require a separate migration or background synchronisation process.

## Requests and decisions API

- `GET /families/:familyId/requests`
- `POST /families/:familyId/requests`
- `POST /families/:familyId/requests/:requestId/respond`
- `GET /requests/action-required-count`

A request names a responding parent and may reference children and a response
deadline. The responding parent may accept, decline, or make one counter-
proposal; the creator may then accept or decline that alternative. Proposal and
response content is immutable. Acceptance atomically creates a separate
Agreement snapshot and an audit event. Read-only professionals may inspect the
record but cannot create or respond.

## Agreement history API

- `GET /families/:familyId/agreements?search=<TEXT>&type=<TYPE>&from=<ISO>&to=<ISO>`

Accepted decisions are searchable by their title, final terms and original
proposal, and can be filtered by request type or agreement date. Each result
contains the immutable original request, its child and document links, every
response in chronological order, the accepted response and the final agreement
snapshot. Results are family-scoped through application checks and PostgreSQL
RLS, and use cursor pagination.

## Shared calendar API

- `GET /families/:familyId/calendar-events?from=<ISO>&to=<ISO>`
- `POST /families/:familyId/calendar-events`
- `PATCH /families/:familyId/calendar-events/:eventId`
- `POST /families/:familyId/calendar-events/:eventId/cancel`
- `GET /families/:familyId/calendar-events/:eventId/history`

Calendar changes append immutable versions; they never overwrite prior event
content. Instants are stored as timezone-aware PostgreSQL values and retain the
IANA timezone used for display. PostgreSQL functions validate family, parent,
and child relationships and append audit events atomically.

## Read-only calendar subscriptions

- `GET /families/:familyId/calendar-subscriptions`
- `POST /families/:familyId/calendar-subscriptions`
- `POST /families/:familyId/calendar-subscriptions/:subscriptionId/revoke`
- `GET /calendar-feeds/:token/calendar.ics` (private bearer URL)

Owners and parents can create a high-entropy, read-only iCalendar URL for Apple
Calendar, Google Calendar or Outlook. Only the SHA-256 token digest is stored;
the raw URL is returned once. Creators and family owners may revoke a feed, and
feeds stop resolving automatically if their creator loses writable membership.
The export contains event titles, handover locations and living-arrangement
labels, but excludes descriptions, notes, messages, expenses and documents.
Calendar clients receive a rolling window from 30 days ago through one year in
the future with cache prevention and crawler-exclusion headers. Production
reverse proxies and observability systems must redact the token segment from
calendar-feed request URLs and must never forward it to analytics platforms.

## Recurring living arrangements API

- `GET /families/:familyId/living-arrangements`
- `GET /families/:familyId/living-arrangements/occurrences?from=<ISO>&to=<ISO>`
- `POST /families/:familyId/living-arrangements`
- `POST /families/:familyId/living-arrangements/:arrangementId/exceptions`

Parents can define weekly or alternating-week arrangements for selected
children and a responsible parent. Occurrences are generated in the saved IANA
timezone, so local handover times remain stable across daylight-saving changes.
Overlapping arrangements for a child are rejected at the database boundary.
One-off skips are permanent exception records with a reason; the recurring
schedule and its audit history are not overwritten.

## Child expenses API

- `GET /families/:familyId/expenses`
- `GET /families/:familyId/expenses/ledger?childId=<childId>`
- `POST /families/:familyId/expenses`
- `PATCH /families/:familyId/expenses/:expenseId`
- `POST /families/:familyId/expenses/:expenseId/respond`

Amounts are stored as integer pence and allocations must total exactly 100%.
Only accepted current versions contribute to the ledger balance. Declines and
disputes require a note. Corrections append a new immutable version and require
fresh acknowledgement; prior proposals and responses remain permanent.

This project is a backend service for the CoParent application, built using [NestJS](https://nestjs.com/), [Prisma](https://www.prisma.io/), and PostgreSQL. It runs in a Dockerized environment using `docker-compose`.

---

## 🧱 Project Structure

coparent/
├── coparent-backend/ # NestJS backend project
│ ├── src/ # Source code
│ ├── prisma/ # Prisma schema and migrations
│ ├── Dockerfile # Docker build file for backend
│ └── ...
├── docker-compose.yml # Docker Compose configuration
└── README.md # Project instructions

---

## 🚀 Getting Started

### ✅ Prerequisites

- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)

---

## 🐳 Running the Project

### 1. Clone the Repository

git clone <your-repo-url>
cd coparent 2. Start Services with Docker Compose

docker-compose up --build
This will:

Start a PostgreSQL container on port 5432

Build and run the NestJS backend server on port 3000

You should now be able to access the backend at:

http://localhost:3000
🛠 Environment Variables
The backend expects a valid PostgreSQL connection string in the format:

DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<db>
This is injected in docker-compose.yml and passed to the container via:

environment:
DATABASE_URL: postgresql://postgres:prisma@postgres:5432/postgres
🧪 Useful Commands
Run Migrations
If you make changes to your Prisma schema, run:

docker exec -it coparent-backend npx prisma migrate dev --name <migration-name>
Open Prisma Studio (optional GUI)

docker exec -it coparent-backend npx prisma studio
🧹 Cleanup
To stop and remove all containers and volumes:

docker-compose down -v
🧾 Notes
Database volume is stored persistently using Docker volumes under pg_data

Code changes will auto-reload in development mode (npm run start:dev)

Prisma migrations and seed data should be added to the coparent-backend/prisma/ folder

## 🧪 Initial Setup (Local Development)

After running `docker-compose up --build`, run the following commands:

1. Apply database schema and migrations:

docker exec -it coparent-backend npx prisma migrate dev --name init
Generate the Prisma client (if needed):

docker exec -it coparent-backend npx prisma generate
(Optional) Open Prisma Studio:

docker exec -it coparent-backend npx prisma studio
Access it at: http://localhost:5555

There is a seed.ts file in the prisma folder which can be used to add some users to the db by running:
docker exec -it coparent-backend npx ts-node prisma/seed.ts
inside the coparent-backend Docker container

📦 Tech Stack
Backend: NestJS

ORM: Prisma

Database: PostgreSQL (via Docker)

Runtime: Node.js 24.19 LTS

📮 Contact
For questions or contributions, please raise an issue or contact the project maintainers.

```

```
