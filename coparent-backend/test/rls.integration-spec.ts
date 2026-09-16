import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

const adminUrl = process.env.ADMIN_DATABASE_URL;
const runtimeUrl = process.env.RUNTIME_DATABASE_URL;

if (!adminUrl || !runtimeUrl) {
  throw new Error(
    'RLS integration tests require admin and runtime database URLs',
  );
}

const admin = new PrismaClient({ datasourceUrl: adminUrl });
const runtime = new PrismaClient({ datasourceUrl: runtimeUrl });

const ids = {
  alice: '10000000-0000-4000-8000-000000000001',
  bob: '10000000-0000-4000-8000-000000000002',
  professional: '10000000-0000-4000-8000-000000000003',
  charlie: '10000000-0000-4000-8000-000000000004',
  mallory: '10000000-0000-4000-8000-000000000005',
  familyA: '20000000-0000-4000-8000-000000000001',
  familyB: '20000000-0000-4000-8000-000000000002',
  childA: '30000000-0000-4000-8000-000000000001',
  childB: '30000000-0000-4000-8000-000000000002',
  validInvitation: '40000000-0000-4000-8000-000000000001',
  expiredInvitation: '40000000-0000-4000-8000-000000000002',
  declinedInvitation: '40000000-0000-4000-8000-000000000003',
  revokedInvitation: '40000000-0000-4000-8000-000000000004',
  emailJob: '50000000-0000-4000-8000-000000000001',
  message: '60000000-0000-4000-8000-000000000001',
  blockedMessage: '60000000-0000-4000-8000-000000000002',
  familyRequest: '70000000-0000-4000-8000-000000000001',
  blockedFamilyRequest: '70000000-0000-4000-8000-000000000002',
  counterResponse: '80000000-0000-4000-8000-000000000001',
  acceptResponse: '80000000-0000-4000-8000-000000000002',
  agreement: '90000000-0000-4000-8000-000000000001',
  calendarEvent: 'a0000000-0000-4000-8000-000000000001',
  calendarVersion1: 'a1000000-0000-4000-8000-000000000001',
  calendarVersion2: 'a1000000-0000-4000-8000-000000000002',
  blockedCalendarEvent: 'a0000000-0000-4000-8000-000000000002',
  blockedCalendarVersion: 'a1000000-0000-4000-8000-000000000003',
  arrangement: 'b0000000-0000-4000-8000-000000000001',
  arrangementVersion: 'b1000000-0000-4000-8000-000000000001',
  cancelledArrangementVersion: 'b1000000-0000-4000-8000-000000000003',
  arrangementException: 'b2000000-0000-4000-8000-000000000001',
  blockedArrangement: 'b0000000-0000-4000-8000-000000000002',
  blockedArrangementVersion: 'b1000000-0000-4000-8000-000000000002',
  expense: 'c0000000-0000-4000-8000-000000000001',
  expenseVersion: 'c1000000-0000-4000-8000-000000000001',
  expenseResponse: 'c2000000-0000-4000-8000-000000000001',
  blockedExpense: 'c0000000-0000-4000-8000-000000000002',
  blockedExpenseVersion: 'c1000000-0000-4000-8000-000000000002',
  recurringExpense: 'd0000000-0000-4000-8000-000000000001',
  handover: 'e0000000-0000-4000-8000-000000000001',
  handoverVersion: 'e1000000-0000-4000-8000-000000000001',
  handoverAcknowledgement: 'e2000000-0000-4000-8000-000000000001',
  handoverChecklist: 'e3000000-0000-4000-8000-000000000001',
  blockedHandover: 'e0000000-0000-4000-8000-000000000002',
  blockedHandoverVersion: 'e1000000-0000-4000-8000-000000000002',
  document: 'f0000000-0000-4000-8000-000000000001',
  documentVersion: 'f1000000-0000-4000-8000-000000000001',
  documentVersion2: 'f1000000-0000-4000-8000-000000000002',
  blockedDocument: 'f0000000-0000-4000-8000-000000000002',
  blockedDocumentVersion: 'f1000000-0000-4000-8000-000000000003',
  messageDocument: 'f0000000-0000-4000-8000-000000000010',
  messageDocumentVersion: 'f1000000-0000-4000-8000-000000000010',
  requestDocument: 'f0000000-0000-4000-8000-000000000011',
  requestDocumentVersion: 'f1000000-0000-4000-8000-000000000011',
  responseDocument: 'f0000000-0000-4000-8000-000000000012',
  responseDocumentVersion: 'f1000000-0000-4000-8000-000000000012',
  attachmentMessage: '60000000-0000-4000-8000-000000000010',
  attachmentReplayMessage: '60000000-0000-4000-8000-000000000011',
  attachmentRequest: '70000000-0000-4000-8000-000000000010',
  attachmentResponse: '80000000-0000-4000-8000-000000000010',
  attachmentAgreement: '90000000-0000-4000-8000-000000000010',
  notificationMessage: '60000000-0000-4000-8000-000000000020',
  mutedNotificationMessage: '60000000-0000-4000-8000-000000000021',
  registration: '10000000-0000-4000-8000-000000000006',
  mismatchedRegistration: '10000000-0000-4000-8000-000000000007',
  createdFamily: '20000000-0000-4000-8000-000000000003',
  mismatchedFamily: '20000000-0000-4000-8000-000000000004',
};

const tokens = {
  valid: 'valid-invitation-token-with-sufficient-entropy-for-test',
  expired: 'expired-invitation-token-with-sufficient-entropy-test',
  decline: 'decline-invitation-token-with-sufficient-entropy-test',
  revoke: 'revoke-invitation-token-with-sufficient-entropy-for-test',
};

const hashToken = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex');

async function asActor<T>(
  userId: string,
  callback: (
    tx: Parameters<Parameters<typeof runtime.$transaction>[0]>[0],
  ) => Promise<T>,
) {
  return runtime.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    return callback(tx);
  });
}

async function asFamilyCreator<T>(
  userId: string,
  familyId: string,
  callback: (
    tx: Parameters<Parameters<typeof runtime.$transaction>[0]>[0],
  ) => Promise<T>,
) {
  return runtime.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.creating_family_id', ${familyId}, true)`;
    return callback(tx);
  });
}

describe('PostgreSQL family row-level security', () => {
  beforeAll(async () => {
    await admin.user.createMany({
      data: [
        {
          id: ids.alice,
          firstName: 'Alice',
          lastName: 'A',
          email: 'alice@example.test',
          passwordHash: 'unused',
        },
        {
          id: ids.bob,
          firstName: 'Bob',
          lastName: 'B',
          email: 'bob@example.test',
          passwordHash: 'unused',
        },
        {
          id: ids.professional,
          firstName: 'Pat',
          lastName: 'Professional',
          email: 'professional@example.test',
          passwordHash: 'unused',
        },
        {
          id: ids.charlie,
          firstName: 'Charlie',
          lastName: 'C',
          email: 'charlie@example.test',
          passwordHash: 'unused',
        },
        {
          id: ids.mallory,
          firstName: 'Mallory',
          lastName: 'M',
          email: 'mallory@example.test',
          passwordHash: 'unused',
        },
      ],
    });
    await admin.family.createMany({
      data: [
        { id: ids.familyA, name: 'Family A' },
        { id: ids.familyB, name: 'Family B' },
      ],
    });
    await admin.familyMembership.createMany({
      data: [
        { familyId: ids.familyA, userId: ids.alice, role: 'OWNER' },
        {
          familyId: ids.familyA,
          userId: ids.professional,
          role: 'PROFESSIONAL_READ_ONLY',
        },
        { familyId: ids.familyB, userId: ids.bob, role: 'OWNER' },
      ],
    });
    await admin.child.createMany({
      data: [
        {
          id: ids.childA,
          familyId: ids.familyA,
          firstName: 'Child',
          lastName: 'A',
          dateOfBirth: new Date('2020-01-01'),
        },
        {
          id: ids.childB,
          familyId: ids.familyB,
          firstName: 'Child',
          lastName: 'B',
          dateOfBirth: new Date('2021-01-01'),
        },
      ],
    });
    await admin.auditEvent.create({
      data: {
        familyId: ids.familyA,
        actorId: ids.alice,
        action: 'TEST_EVENT',
        entityType: 'Family',
        entityId: ids.familyA,
      },
    });
    await admin.familyInvitation.createMany({
      data: [
        {
          id: ids.validInvitation,
          familyId: ids.familyA,
          email: 'charlie@example.test',
          role: 'PARENT',
          tokenHash: hashToken(tokens.valid),
          invitedById: ids.alice,
          expiresAt: new Date(Date.now() + 10 * 60_000),
        },
        {
          id: ids.expiredInvitation,
          familyId: ids.familyB,
          email: 'charlie@example.test',
          role: 'PARENT',
          tokenHash: hashToken(tokens.expired),
          invitedById: ids.bob,
          expiresAt: new Date(Date.now() - 60_000),
        },
        {
          id: ids.declinedInvitation,
          familyId: ids.familyB,
          email: 'charlie@example.test',
          role: 'PARENT',
          tokenHash: hashToken(tokens.decline),
          invitedById: ids.bob,
          expiresAt: new Date(Date.now() + 10 * 60_000),
        },
        {
          id: ids.revokedInvitation,
          familyId: ids.familyB,
          email: 'mallory@example.test',
          role: 'PARENT',
          tokenHash: hashToken(tokens.revoke),
          invitedById: ids.bob,
          expiresAt: new Date(Date.now() + 10 * 60_000),
        },
      ],
    });
  });

  afterAll(async () => {
    await Promise.all([admin.$disconnect(), runtime.$disconnect()]);
  });

  it('returns only children from the actor’s family even without an application filter', async () => {
    const children = await asActor(ids.alice, (tx) => tx.child.findMany());
    expect(children.map((child) => child.id)).toEqual([ids.childA]);
  });

  it('conceals another family’s child during a direct identifier lookup', async () => {
    const child = await asActor(ids.alice, (tx) =>
      tx.child.findUnique({ where: { id: ids.childB } }),
    );
    expect(child).toBeNull();
  });

  it('rejects a cross-family write at the database boundary', async () => {
    await expect(
      asActor(ids.alice, (tx) =>
        tx.child.create({
          data: {
            familyId: ids.familyB,
            firstName: 'Blocked',
            lastName: 'Write',
            dateOfBirth: new Date('2022-01-01'),
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('allows professional reads but rejects professional writes', async () => {
    const visible = await asActor(ids.professional, (tx) =>
      tx.child.findMany(),
    );
    expect(visible).toHaveLength(1);
    await expect(
      asActor(ids.professional, (tx) =>
        tx.child.update({
          where: { id: ids.childA },
          data: { school: 'Changed' },
        }),
      ),
    ).rejects.toThrow();
  });

  it('does not leak transaction-local identity into an unscoped query', async () => {
    await asActor(ids.alice, (tx) => tx.family.findMany());
    expect(await runtime.family.findMany()).toEqual([]);
  });

  it('prevents audit updates and deletes even for the migration connection', async () => {
    const event = await admin.auditEvent.findFirstOrThrow({
      where: { action: 'TEST_EVENT' },
    });
    await expect(
      admin.auditEvent.update({
        where: { sequence: event.sequence },
        data: { action: 'ALTERED' },
      }),
    ).rejects.toThrow('Audit events are append-only');
    await expect(
      admin.auditEvent.delete({ where: { sequence: event.sequence } }),
    ).rejects.toThrow('Audit events are append-only');
  });

  it('allows only an actor-bound self registration through RLS', async () => {
    const created = await asActor(ids.registration, (tx) =>
      tx.user.create({
        data: {
          id: ids.registration,
          firstName: 'New',
          lastName: 'Account',
          email: 'new-account@example.test',
          passwordHash: 'unused',
        },
        select: { id: true, email: true },
      }),
    );
    expect(created).toEqual({
      id: ids.registration,
      email: 'new-account@example.test',
    });

    await expect(
      asActor(ids.registration, (tx) =>
        tx.user.create({
          data: {
            id: ids.mismatchedRegistration,
            firstName: 'Blocked',
            lastName: 'Account',
            email: 'blocked-account@example.test',
            passwordHash: 'unused',
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('allows only the transaction-bound family ID to be created and returned', async () => {
    const family = await asFamilyCreator(
      ids.alice,
      ids.createdFamily,
      async (tx) => {
        const created = await tx.family.create({
          data: { id: ids.createdFamily, name: 'Created family' },
          select: { id: true, name: true },
        });
        await tx.familyMembership.create({
          data: {
            familyId: ids.createdFamily,
            userId: ids.alice,
            role: 'OWNER',
          },
        });
        return created;
      },
    );
    expect(family).toEqual({
      id: ids.createdFamily,
      name: 'Created family',
    });

    await expect(
      asFamilyCreator(ids.alice, ids.createdFamily, (tx) =>
        tx.family.create({
          data: { id: ids.mismatchedFamily, name: 'Blocked family' },
        }),
      ),
    ).rejects.toThrow();
  });

  it('lets only a family owner inspect invitation records through RLS', async () => {
    const ownerInvitations = await asActor(ids.alice, (tx) =>
      tx.familyInvitation.findMany(),
    );
    const outsiderInvitations = await asActor(ids.mallory, (tx) =>
      tx.familyInvitation.findMany(),
    );
    expect(ownerInvitations.map((invitation) => invitation.id)).toEqual([
      ids.validInvitation,
    ]);
    expect(outsiderInvitations).toEqual([]);
  });

  it('queues and claims email through functions without direct outbox access', async () => {
    await expect(runtime.emailOutbox.findMany()).rejects.toThrow();

    const enqueued = await asActor(
      ids.alice,
      (tx) =>
        tx.$queryRaw<Array<{ jobId: string }>>`
        SELECT enqueue_coparent_invitation_email(
          ${ids.emailJob}, ${ids.validInvitation}, ${'encrypted-value'},
          ${'initialization-vector'}, ${'authentication-tag'}, ${1}::INTEGER
        ) AS "jobId"
      `,
    );
    expect(enqueued).toEqual([{ jobId: ids.emailJob }]);

    const claimed = await runtime.$queryRaw<
      Array<{ jobId: string; invitationId: string; recipient: string }>
    >`SELECT * FROM claim_coparent_email_outbox(1)`;
    expect(claimed).toEqual([
      expect.objectContaining({
        jobId: ids.emailJob,
        invitationId: ids.validInvitation,
        recipient: 'charlie@example.test',
      }),
    ]);
    await runtime.$executeRaw`
      SELECT complete_coparent_email_outbox(${ids.emailJob}, ${'provider-message-test'})
    `;
    const stored = await admin.emailOutbox.findUniqueOrThrow({
      where: { id: ids.emailJob },
    });
    expect(stored.status).toBe('SENT');
    expect(stored.ciphertext).toBe('');
  });

  it('atomically sends an immutable family message with delivery receipts and audit', async () => {
    await expect(
      asActor(ids.alice, (tx) =>
        tx.message.create({
          data: {
            id: ids.blockedMessage,
            familyId: ids.familyA,
            senderId: ids.alice,
            category: 'GENERAL',
            body: 'Direct inserts are forbidden',
          },
        }),
      ),
    ).rejects.toThrow();

    const created = await asActor(
      ids.alice,
      (tx) =>
        tx.$queryRaw<Array<{ messageId: string }>>`
          SELECT create_coparent_message(
            ${ids.message}, ${ids.familyA}, ${'SCHOOL'},
            ${'School collection will be at 15:30.'}, ARRAY[${ids.childA}]::TEXT[]
          ) AS "messageId"
        `,
    );
    expect(created).toEqual([{ messageId: ids.message }]);

    const visible = await asActor(ids.professional, (tx) =>
      tx.message.findMany({
        include: { children: true, receipts: true },
      }),
    );
    expect(visible).toEqual([
      expect.objectContaining({
        id: ids.message,
        senderId: ids.alice,
        category: 'SCHOOL',
        body: 'School collection will be at 15:30.',
        children: [{ messageId: ids.message, childId: ids.childA }],
      }),
    ]);
    expect(
      visible[0]?.receipts.find((receipt) => receipt.userId === ids.alice)
        ?.readAt,
    ).toBeInstanceOf(Date);
    expect(
      visible[0]?.receipts.find(
        (receipt) => receipt.userId === ids.professional,
      )?.readAt,
    ).toBeNull();
    expect(await asActor(ids.mallory, (tx) => tx.message.findMany())).toEqual(
      [],
    );
    await expect(
      asActor(
        ids.professional,
        (tx) =>
          tx.$queryRaw<Array<{ count: number }>>`
          SELECT count_coparent_unread_messages() AS "count"
        `,
      ),
    ).resolves.toEqual([{ count: 1 }]);
    await expect(
      asActor(
        ids.mallory,
        (tx) =>
          tx.$queryRaw<Array<{ count: number }>>`
          SELECT count_coparent_unread_messages() AS "count"
        `,
      ),
    ).resolves.toEqual([{ count: 0 }]);

    const audit = await admin.auditEvent.findFirst({
      where: { entityId: ids.message, action: 'MESSAGE_SENT' },
    });
    expect(audit).not.toBeNull();
    await expect(
      admin.message.update({
        where: { id: ids.message },
        data: { body: 'Changed historical text' },
      }),
    ).rejects.toThrow('Sent message records are immutable');
    await expect(
      admin.message.delete({ where: { id: ids.message } }),
    ).rejects.toThrow('Sent message records are immutable');
  });

  it('allows read-only professionals to mark read but never send', async () => {
    const blocked = await asActor(
      ids.professional,
      (tx) =>
        tx.$queryRaw<Array<{ messageId: string | null }>>`
          SELECT create_coparent_message(
            ${ids.blockedMessage}, ${ids.familyA}, ${'GENERAL'},
            ${'A professional must not send this.'}, ARRAY[]::TEXT[]
          ) AS "messageId"
        `,
    );
    expect(blocked).toEqual([{ messageId: null }]);

    const read = await asActor(
      ids.professional,
      (tx) =>
        tx.$queryRaw<Array<{ readAt: Date }>>`
          SELECT mark_coparent_message_read(${ids.message}, ${ids.familyA}) AS "readAt"
        `,
    );
    expect(read[0]?.readAt).toBeInstanceOf(Date);
    await expect(
      asActor(
        ids.professional,
        (tx) =>
          tx.$queryRaw<Array<{ count: number }>>`
          SELECT count_coparent_unread_messages() AS "count"
        `,
      ),
    ).resolves.toEqual([{ count: 0 }]);
  });

  it('rejects message child links outside the selected family', async () => {
    const blocked = await asActor(
      ids.alice,
      (tx) =>
        tx.$queryRaw<Array<{ messageId: string | null }>>`
          SELECT create_coparent_message(
            ${ids.blockedMessage}, ${ids.familyA}, ${'GENERAL'},
            ${'Cross-family child link'}, ARRAY[${ids.childB}]::TEXT[]
          ) AS "messageId"
        `,
    );
    expect(blocked).toEqual([{ messageId: null }]);
  });

  it('does not allow a valid bearer token to be used by the wrong account', async () => {
    const result = await asActor(
      ids.mallory,
      (tx) =>
        tx.$queryRaw<unknown[]>`
        SELECT * FROM accept_coparent_family_invitation(${hashToken(tokens.valid)})
      `,
    );
    expect(result).toEqual([]);
  });

  it('exposes the invitation resolution predicates used by the database', async () => {
    const [actorContext, ownerContext, invitationContext] = await Promise.all([
      asActor(
        ids.charlie,
        (tx) =>
          tx.$queryRaw<Array<{ actorId: string | null }>>`
          SELECT current_coparent_user_id() AS "actorId"
        `,
      ),
      asActor(
        ids.bob,
        (tx) =>
          tx.$queryRaw<Array<{ isOwner: boolean }>>`
          SELECT is_coparent_family_owner(${ids.familyB}) AS "isOwner"
        `,
      ),
      admin.$queryRaw<
        Array<{
          tokenMatches: boolean;
          emailMatches: boolean;
          isPending: boolean;
          isUnexpired: boolean;
        }>
      >`
        SELECT
          invitation."tokenHash" = ${hashToken(tokens.valid)} AS "tokenMatches",
          lower(invitation."email") = lower(account."email") AS "emailMatches",
          invitation."status" = 'PENDING'::"InvitationStatus" AS "isPending",
          invitation."expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') AS "isUnexpired"
        FROM "FamilyInvitation" AS invitation
        JOIN "User" AS account ON account."id" = ${ids.charlie}
        WHERE invitation."id" = ${ids.validInvitation}
      `,
    ]);

    expect({
      actorId: actorContext[0]?.actorId,
      ownerPredicate: ownerContext[0]?.isOwner,
      ...invitationContext[0],
    }).toEqual({
      actorId: ids.charlie,
      ownerPredicate: true,
      tokenMatches: true,
      emailMatches: true,
      isPending: true,
      isUnexpired: true,
    });
  });

  it('atomically accepts an invitation for the matching account and audits it', async () => {
    const result = await asActor(
      ids.charlie,
      (tx) =>
        tx.$queryRaw<Array<{ invitationId: string; familyId: string }>>`
        SELECT * FROM accept_coparent_family_invitation(${hashToken(tokens.valid)})
      `,
    );
    expect(result).toEqual([
      {
        invitationId: ids.validInvitation,
        familyId: ids.familyA,
        role: 'PARENT',
      },
    ]);

    const state = await asActor(ids.charlie, async (tx) => ({
      membership: await tx.familyMembership.findUnique({
        where: {
          familyId_userId: { familyId: ids.familyA, userId: ids.charlie },
        },
      }),
      audit: await tx.auditEvent.findFirst({
        where: {
          action: 'FAMILY_INVITATION_ACCEPTED',
          entityId: ids.validInvitation,
        },
      }),
    }));
    expect(state.membership?.role).toBe('PARENT');
    expect(state.audit?.actorId).toBe(ids.charlie);
  });

  it('creates a request only for another writable family member', async () => {
    const blocked = await asActor(
      ids.professional,
      (tx) =>
        tx.$queryRaw<Array<{ requestId: string | null }>>`
          SELECT create_coparent_family_request(
            ${ids.blockedFamilyRequest}, ${ids.familyA}, ${ids.alice},
            ${'HOLIDAY'}, ${'Blocked'}, ${'Professionals cannot create requests.'},
            ${null}::TIMESTAMP, ARRAY[]::TEXT[]
          ) AS "requestId"
        `,
    );
    expect(blocked).toEqual([{ requestId: null }]);

    const created = await asActor(
      ids.alice,
      (tx) =>
        tx.$queryRaw<Array<{ requestId: string | null }>>`
          SELECT create_coparent_family_request(
            ${ids.familyRequest}, ${ids.familyA}, ${ids.charlie},
            ${'ARRANGEMENT_SWAP'}, ${'Swap Saturday'},
            ${'Please swap Saturday for Tuesday evening.'}, ${null}::TIMESTAMP,
            ARRAY[${ids.childA}]::TEXT[]
          ) AS "requestId"
        `,
    );
    expect(created).toEqual([{ requestId: ids.familyRequest }]);
    await expect(
      asActor(
        ids.charlie,
        (tx) =>
          tx.$queryRaw<Array<{ count: number }>>`
          SELECT count_coparent_action_required_requests() AS "count"
        `,
      ),
    ).resolves.toEqual([{ count: 1 }]);
    await expect(
      asActor(ids.mallory, (tx) => tx.familyRequest.findMany()),
    ).resolves.toEqual([]);
  });

  it('records a counter-proposal and atomically snapshots an accepted agreement', async () => {
    const countered = await asActor(
      ids.charlie,
      (tx) =>
        tx.$queryRaw<
          Array<{
            requestId: string;
            status: string;
            agreementId: string | null;
          }>
        >`
          SELECT * FROM respond_to_coparent_family_request(
            ${ids.familyRequest}, ${ids.counterResponse}, ${'COUNTER_PROPOSAL'},
            ${'Tuesday works if collection is at 18:30.'}, ${ids.agreement}
          )
        `,
    );
    expect(countered).toEqual([
      { requestId: ids.familyRequest, status: 'COUNTERED', agreementId: null },
    ]);
    await expect(
      asActor(
        ids.alice,
        (tx) =>
          tx.$queryRaw<Array<{ count: number }>>`
          SELECT count_coparent_action_required_requests() AS "count"
        `,
      ),
    ).resolves.toEqual([{ count: 1 }]);

    const accepted = await asActor(
      ids.alice,
      (tx) =>
        tx.$queryRaw<
          Array<{
            requestId: string;
            status: string;
            agreementId: string | null;
          }>
        >`
          SELECT * FROM respond_to_coparent_family_request(
            ${ids.familyRequest}, ${ids.acceptResponse}, ${'ACCEPT'}, ${null}, ${ids.agreement}
          )
        `,
    );
    expect(accepted).toEqual([
      {
        requestId: ids.familyRequest,
        status: 'ACCEPTED',
        agreementId: ids.agreement,
      },
    ]);
    const agreement = await admin.agreement.findUniqueOrThrow({
      where: { id: ids.agreement },
    });
    expect(agreement.terms).toBe('Tuesday works if collection is at 18:30.');
    await expect(
      admin.familyRequest.update({
        where: { id: ids.familyRequest },
        data: { details: 'Altered proposal' },
      }),
    ).rejects.toThrow('Request proposal content is immutable');
    await expect(
      admin.agreement.delete({ where: { id: ids.agreement } }),
    ).rejects.toThrow('Request history is immutable');
  });

  it('creates and revises calendar events while preserving immutable history', async () => {
    const blocked = await asActor(
      ids.professional,
      (tx) =>
        tx.$queryRaw<Array<{ eventId: string | null }>>`
        SELECT create_coparent_calendar_event(
          ${ids.blockedCalendarEvent}, ${ids.blockedCalendarVersion}, ${ids.familyA},
          ${'SCHOOL'}, ${'Blocked'}, ${null}, ${new Date('2026-09-01T14:00:00Z')}::TIMESTAMPTZ,
          ${new Date('2026-09-01T15:00:00Z')}::TIMESTAMPTZ, ${'Europe/London'}, ${ids.alice}, ARRAY[]::TEXT[]
        ) AS "eventId"`,
    );
    expect(blocked).toEqual([{ eventId: null }]);

    const created = await asActor(
      ids.alice,
      (tx) =>
        tx.$queryRaw<Array<{ eventId: string | null }>>`
        SELECT create_coparent_calendar_event(
          ${ids.calendarEvent}, ${ids.calendarVersion1}, ${ids.familyA}, ${'SCHOOL'},
          ${'School collection'}, ${'Collect from the main gate.'},
          ${new Date('2026-09-01T14:00:00Z')}::TIMESTAMPTZ,
          ${new Date('2026-09-01T15:00:00Z')}::TIMESTAMPTZ, ${'Europe/London'}, ${ids.charlie},
          ARRAY[${ids.childA}]::TEXT[]
        ) AS "eventId"`,
    );
    expect(created).toEqual([{ eventId: ids.calendarEvent }]);
    expect(
      await asActor(ids.mallory, (tx) => tx.calendarEvent.findMany()),
    ).toEqual([]);
    expect(
      await asActor(ids.professional, (tx) => tx.calendarEvent.findMany()),
    ).toHaveLength(1);

    const revised = await asActor(
      ids.charlie,
      (tx) =>
        tx.$queryRaw<Array<{ eventId: string | null }>>`
        SELECT revise_coparent_calendar_event(
          ${ids.calendarEvent}, ${ids.calendarVersion2}, ${ids.familyA}, ${'SCHOOL'},
          ${'School collection'}, ${'Collect from reception.'},
          ${new Date('2026-09-01T14:30:00Z')}::TIMESTAMPTZ,
          ${new Date('2026-09-01T15:30:00Z')}::TIMESTAMPTZ, ${'Europe/London'}, ${ids.charlie},
          ${'School changed collection time.'}, ARRAY[${ids.childA}]::TEXT[]
        ) AS "eventId"`,
    );
    expect(revised).toEqual([{ eventId: ids.calendarEvent }]);
    const stored = await admin.calendarEvent.findUniqueOrThrow({
      where: { id: ids.calendarEvent },
      include: { versions: true },
    });
    expect(stored.currentVersionId).toBe(ids.calendarVersion2);
    expect(stored.versions).toHaveLength(2);
    await expect(
      admin.calendarEventVersion.update({
        where: { id: ids.calendarVersion1 },
        data: { title: 'Changed' },
      }),
    ).rejects.toThrow('Calendar history is immutable');
    await expect(
      admin.calendarEvent.update({
        where: { id: ids.calendarEvent },
        data: { currentVersionId: ids.calendarVersion1 },
      }),
    ).rejects.toThrow(
      'Calendar current version may change only through a transition function',
    );
  });

  it('generates timezone-safe recurring arrangements and immutable exceptions', async () => {
    const blocked = await asActor(
      ids.professional,
      (tx) =>
        tx.$queryRaw<Array<{ arrangementId: string | null }>>`
        SELECT create_coparent_living_arrangement(
          ${ids.blockedArrangement}, ${ids.blockedArrangementVersion}, ${ids.familyA},
          ${'Blocked'}, ${'WEEKLY'}, ${7}::INTEGER, ${1020}::INTEGER, ${60}::INTEGER,
          ${new Date('2026-10-18T00:00:00Z')}::DATE, ${null}::DATE, ${'Europe/London'},
          ${ids.professional}, ARRAY[${ids.childA}]::TEXT[]
        ) AS "arrangementId"`,
    );
    expect(blocked).toEqual([{ arrangementId: null }]);

    const created = await asActor(
      ids.alice,
      (tx) =>
        tx.$queryRaw<Array<{ arrangementId: string | null }>>`
        SELECT create_coparent_living_arrangement(
          ${ids.arrangement}, ${ids.arrangementVersion}, ${ids.familyA}, ${'With Charlie'},
          ${'WEEKLY'}, ${7}::INTEGER, ${1020}::INTEGER, ${60}::INTEGER,
          ${new Date('2026-10-18T00:00:00Z')}::DATE, ${null}::DATE, ${'Europe/London'},
          ${ids.charlie}, ARRAY[${ids.childA}]::TEXT[]
        ) AS "arrangementId"`,
    );
    expect(created).toEqual([{ arrangementId: ids.arrangement }]);
    const occurrences = await asActor(
      ids.charlie,
      (tx) =>
        tx.$queryRaw<Array<{ occurrenceDate: Date; startsAt: Date }>>`
        SELECT "occurrenceDate", "startsAt" FROM list_coparent_living_occurrences(
          ${ids.familyA}, ${new Date('2026-10-17T00:00:00Z')}::TIMESTAMPTZ,
          ${new Date('2026-11-01T00:00:00Z')}::TIMESTAMPTZ
        ) ORDER BY "occurrenceDate"`,
    );
    expect(occurrences.map((item) => item.startsAt.toISOString())).toEqual([
      '2026-10-18T16:00:00.000Z',
      '2026-10-25T17:00:00.000Z',
    ]);
    const skipped = await asActor(
      ids.alice,
      (tx) =>
        tx.$queryRaw<Array<{ exceptionId: string | null }>>`
        SELECT skip_coparent_living_occurrence(
          ${ids.arrangementException}, ${ids.arrangement}, ${ids.familyA},
          ${new Date('2026-10-18T00:00:00Z')}::DATE, ${'Holiday exception'}
        ) AS "exceptionId"`,
    );
    expect(skipped).toEqual([{ exceptionId: ids.arrangementException }]);
    await expect(
      admin.livingArrangementException.delete({
        where: { id: ids.arrangementException },
      }),
    ).rejects.toThrow('Living arrangement history is immutable');

    const cancelled = await asActor(
      ids.alice,
      (tx) =>
        tx.$queryRaw<Array<{ arrangementId: string | null }>>`
        SELECT cancel_coparent_living_arrangement(
          ${ids.arrangement}, ${ids.cancelledArrangementVersion}, ${ids.familyA},
          ${'The normal pattern has changed'}
        ) AS "arrangementId"`,
    );
    expect(cancelled).toEqual([{ arrangementId: ids.arrangement }]);
    const afterCancellation = await asActor(
      ids.charlie,
      (tx) => tx.$queryRaw<unknown[]>`
        SELECT * FROM list_coparent_living_occurrences(
          ${ids.familyA}, ${new Date('2026-11-01T00:00:00Z')}::TIMESTAMPTZ,
          ${new Date('2026-11-30T00:00:00Z')}::TIMESTAMPTZ
        )`,
    );
    expect(afterCancellation).toEqual([]);
  });

  it('protects proposed expenses, exact allocations, acceptance, and immutable history', async () => {
    const blocked = await asActor(
      ids.professional,
      (tx) => tx.$queryRaw<Array<{ expenseId: string | null }>>`
        SELECT create_coparent_expense(
          ${ids.blockedExpense}, ${ids.blockedExpenseVersion}, ${ids.familyA},
          ${ids.charlie}, ${'SCHOOL'}, ${'Blocked expense'}, ${null},
          ${12001}::INTEGER, ${new Date('2026-08-30T00:00:00Z')}::DATE,
          ${ids.alice}, ARRAY[${ids.alice},${ids.charlie}]::TEXT[],
          ARRAY[5000,5000]::INTEGER[], ARRAY[${ids.childA}]::TEXT[]
        ) AS "expenseId"`,
    );
    expect(blocked).toEqual([{ expenseId: null }]);

    const created = await asActor(
      ids.alice,
      (tx) => tx.$queryRaw<Array<{ expenseId: string | null }>>`
        SELECT create_coparent_expense(
          ${ids.expense}, ${ids.expenseVersion}, ${ids.familyA}, ${ids.charlie},
          ${'SCHOOL'}, ${'School trip'}, ${'Autumn residential'}, ${12001}::INTEGER,
          ${new Date('2026-08-30T00:00:00Z')}::DATE, ${ids.alice},
          ARRAY[${ids.alice},${ids.charlie}]::TEXT[], ARRAY[5000,5000]::INTEGER[],
          ARRAY[${ids.childA}]::TEXT[]
        ) AS "expenseId"`,
    );
    expect(created).toEqual([{ expenseId: ids.expense }]);
    const shares = await asActor(ids.charlie, (tx) =>
      tx.expenseAllocation.findMany({
        where: { versionId: ids.expenseVersion },
        orderBy: { userId: 'asc' },
        select: { amountMinor: true },
      }),
    );
    expect(shares.reduce((sum, item) => sum + item.amountMinor, 0)).toBe(12001);

    const accepted = await asActor(
      ids.charlie,
      (tx) => tx.$queryRaw<Array<{ expenseId: string | null }>>`
        SELECT respond_to_coparent_expense(
          ${ids.expense}, ${ids.expenseResponse}, ${ids.familyA}, ${'ACCEPT'}, ${null}
        ) AS "expenseId"`,
    );
    expect(accepted).toEqual([{ expenseId: ids.expense }]);
    await expect(
      admin.expenseVersion.update({
        where: { id: ids.expenseVersion },
        data: { amountMinor: 1 },
      }),
    ).rejects.toThrow('Expense history is immutable');

    const recurring = await asActor(
      ids.alice,
      (tx) => tx.$queryRaw<Array<{ recurringId: string | null }>>`
        SELECT create_coparent_recurring_expense(
          ${ids.recurringExpense},${ids.familyA},${'ACTIVITY'},${'Swimming'},${null},
          ${6000}::INTEGER,${'MONTHLY'},${new Date('2026-08-30T00:00:00Z')}::DATE,
          ${null}::DATE,${ids.alice},ARRAY[${ids.alice},${ids.charlie}]::TEXT[],
          ARRAY[5000,5000]::INTEGER[],ARRAY[${ids.childA}]::TEXT[]
        ) AS "recurringId"`,
    );
    expect(recurring).toEqual([{ recurringId: ids.recurringExpense }]);
    await expect(
      admin.recurringExpense.update({
        where: { id: ids.recurringExpense },
        data: { amountMinor: 1 },
      }),
    ).rejects.toThrow('Recurring expense content is immutable');
  });

  it('protects scheduled handovers, acknowledgements, and immutable history', async () => {
    const blocked = await asActor(
      ids.professional,
      (tx) => tx.$queryRaw<Array<{ handoverId: string | null }>>`
        SELECT create_coparent_handover(
          ${ids.blockedHandover},${ids.blockedHandoverVersion},${ids.familyA},
          ${new Date('2026-09-20T09:00:00Z')}::TIMESTAMPTZ,${'Europe/London'},
          ${'School gate'},${null},${ids.alice},${ids.charlie},
          ARRAY[${ids.childA}]::TEXT[],ARRAY[]::TEXT[],ARRAY[]::TEXT[]
        ) AS "handoverId"`,
    );
    expect(blocked).toEqual([{ handoverId: null }]);

    const created = await asActor(
      ids.alice,
      (tx) => tx.$queryRaw<Array<{ handoverId: string | null }>>`
        SELECT create_coparent_handover(
          ${ids.handover},${ids.handoverVersion},${ids.familyA},
          ${new Date('2026-09-20T09:00:00Z')}::TIMESTAMPTZ,${'Europe/London'},
          ${'School gate'},${'Bring the school bag'},${ids.alice},${ids.charlie},
          ARRAY[${ids.childA}]::TEXT[],ARRAY[${ids.handoverChecklist}]::TEXT[],
          ARRAY[${'School equipment'}]::TEXT[]
        ) AS "handoverId"`,
    );
    expect(created).toEqual([{ handoverId: ids.handover }]);
    expect(
      await asActor(ids.charlie, (tx) => tx.handover.findMany()),
    ).toHaveLength(1);
    expect(await asActor(ids.bob, (tx) => tx.handover.findMany())).toHaveLength(
      0,
    );

    const acknowledged = await asActor(
      ids.charlie,
      (tx) => tx.$queryRaw<Array<{ handoverId: string | null }>>`
        SELECT acknowledge_coparent_handover(
          ${ids.handover},${ids.handoverAcknowledgement},${ids.familyA},
          ${'COMPLETED'},${null},ARRAY[${ids.handoverChecklist}]::TEXT[]
        ) AS "handoverId"`,
    );
    expect(acknowledged).toEqual([{ handoverId: ids.handover }]);
    await expect(
      admin.handoverVersion.update({
        where: { id: ids.handoverVersion },
        data: { location: 'Altered later' },
      }),
    ).rejects.toThrow('Handover history is immutable');
  });

  it('isolates document metadata and preserves every document version', async () => {
    const hash = 'a'.repeat(64);
    const blocked = await asActor(
      ids.professional,
      (tx) => tx.$queryRaw<Array<{ documentId: string | null }>>`
        SELECT create_coparent_document(
          ${ids.blockedDocument},${ids.blockedDocumentVersion},${ids.familyA},${null},
          ${'GENERAL'},${'Blocked'},${null},${'blocked.pdf'},${'application/pdf'},
          ${10}::INTEGER,${hash},${'aa/00000000-0000-4000-8000-000000000001.bin'},
          ${'iv'},${'tag'},${1}::INTEGER,ARRAY[${ids.childA}]::TEXT[]
        ) AS "documentId"`,
    );
    expect(blocked).toEqual([{ documentId: null }]);

    const created = await asActor(
      ids.alice,
      (tx) => tx.$queryRaw<Array<{ documentId: string | null }>>`
        SELECT create_coparent_document(
          ${ids.document},${ids.documentVersion},${ids.familyA},${ids.expense},
          ${'RECEIPT'},${'School trip receipt'},${'Original receipt'},${'receipt.pdf'},
          ${'application/pdf'},${10}::INTEGER,${hash},
          ${'aa/00000000-0000-4000-8000-000000000002.bin'},${'iv'},${'tag'},
          ${1}::INTEGER,ARRAY[${ids.childA}]::TEXT[]
        ) AS "documentId"`,
    );
    expect(created).toEqual([{ documentId: ids.document }]);
    expect(
      await asActor(ids.charlie, (tx) => tx.document.findMany()),
    ).toHaveLength(1);
    expect(await asActor(ids.bob, (tx) => tx.document.findMany())).toHaveLength(
      0,
    );

    const revised = await asActor(
      ids.charlie,
      (tx) => tx.$queryRaw<Array<{ documentId: string | null }>>`
        SELECT revise_coparent_document(
          ${ids.document},${ids.documentVersion2},${ids.familyA},${'RECEIPT'},
          ${'School trip receipt'},${'Clearer scan'},${'receipt-v2.pdf'},
          ${'application/pdf'},${12}::INTEGER,${'b'.repeat(64)},
          ${'bb/00000000-0000-4000-8000-000000000003.bin'},${'iv2'},${'tag2'},
          ${1}::INTEGER,${'Uploaded a clearer copy'}
        ) AS "documentId"`,
    );
    expect(revised).toEqual([{ documentId: ids.document }]);
    expect(
      await admin.documentVersion.count({
        where: { documentId: ids.document },
      }),
    ).toBe(2);
    await expect(
      admin.documentVersion.update({
        where: { id: ids.documentVersion },
        data: { title: 'Changed later' },
      }),
    ).rejects.toThrow('Document history is immutable');
  });

  it('atomically freezes message, request, and response attachments', async () => {
    const hash = 'c'.repeat(64);
    const createDocument = async (
      actor: string,
      documentId: string,
      versionId: string,
    ) =>
      asActor(
        actor,
        (tx) => tx.$queryRaw<Array<{ documentId: string | null }>>`
        SELECT create_coparent_document(
          ${documentId},${versionId},${ids.familyA},${null},${'GENERAL'},
          ${'Supporting document'},${null},${'support.pdf'},${'application/pdf'},
          ${10}::INTEGER,${hash},${`cc/${documentId}.bin`},${'iv'},${'tag'},
          ${1}::INTEGER,ARRAY[${ids.childA}]::TEXT[]
        ) AS "documentId"`,
      );
    await expect(
      createDocument(
        ids.alice,
        ids.messageDocument,
        ids.messageDocumentVersion,
      ),
    ).resolves.toEqual([{ documentId: ids.messageDocument }]);
    await expect(
      createDocument(
        ids.alice,
        ids.requestDocument,
        ids.requestDocumentVersion,
      ),
    ).resolves.toEqual([{ documentId: ids.requestDocument }]);
    await expect(
      createDocument(
        ids.charlie,
        ids.responseDocument,
        ids.responseDocumentVersion,
      ),
    ).resolves.toEqual([{ documentId: ids.responseDocument }]);

    const message = await asActor(
      ids.alice,
      (tx) => tx.$queryRaw<Array<{ messageId: string | null }>>`
      SELECT create_coparent_message_with_attachments(
        ${ids.attachmentMessage},${ids.familyA},${'GENERAL'},${'Attached evidence'},
        ARRAY[${ids.childA}]::TEXT[],ARRAY[${ids.messageDocument}]::TEXT[]
      ) AS "messageId"`,
    );
    expect(message).toEqual([{ messageId: ids.attachmentMessage }]);
    const replay = await asActor(
      ids.alice,
      (tx) => tx.$queryRaw<Array<{ messageId: string | null }>>`
      SELECT create_coparent_message_with_attachments(
        ${ids.attachmentReplayMessage},${ids.familyA},${'GENERAL'},${'Replay'},
        ARRAY[]::TEXT[],ARRAY[${ids.messageDocument}]::TEXT[]
      ) AS "messageId"`,
    );
    expect(replay).toEqual([{ messageId: null }]);
    expect(
      await admin.message.findUnique({
        where: { id: ids.attachmentReplayMessage },
      }),
    ).toBeNull();

    const request = await asActor(
      ids.alice,
      (tx) => tx.$queryRaw<Array<{ requestId: string | null }>>`
      SELECT create_coparent_family_request_with_attachments(
        ${ids.attachmentRequest},${ids.familyA},${ids.charlie},${'SCHOOL'},
        ${'School document review'},${'Please review the attached letter'},${null}::TIMESTAMP,
        ARRAY[${ids.childA}]::TEXT[],ARRAY[${ids.requestDocument}]::TEXT[]
      ) AS "requestId"`,
    );
    expect(request).toEqual([{ requestId: ids.attachmentRequest }]);
    const response = await asActor(
      ids.charlie,
      (tx) => tx.$queryRaw<unknown[]>`
      SELECT * FROM respond_to_coparent_family_request_with_attachments(
        ${ids.attachmentRequest},${ids.attachmentResponse},${'COUNTER_PROPOSAL'},
        ${'Please consider this alternative'},${ids.attachmentAgreement},
        ARRAY[${ids.responseDocument}]::TEXT[]
      )`,
    );
    expect(response).toHaveLength(1);
    await expect(
      admin.documentMessage.delete({
        where: { documentId: ids.messageDocument },
      }),
    ).rejects.toThrow('Document history is immutable');
    await expect(
      admin.documentVersion.create({
        data: {
          id: 'f1000000-0000-4000-8000-000000000099',
          documentId: ids.messageDocument,
          revision: 2,
          category: 'GENERAL',
          title: 'Replacement',
          originalFileName: 'replacement.pdf',
          mediaType: 'application/pdf',
          plaintextSize: 10,
          sha256: 'd'.repeat(64),
          storageKey: 'dd/00000000-0000-4000-8000-000000000099.bin',
          initializationVector: 'iv',
          authenticationTag: 'tag',
          changedById: ids.alice,
          changeReason: 'Attempted replacement',
        },
      }),
    ).rejects.toThrow('Attached document content is immutable');
  });

  it('isolates notifications, honours preferences, and protects notification identity', async () => {
    const before = await asActor(ids.charlie, (tx) => tx.notification.count());
    await asActor(ids.alice, (tx) => tx.$queryRaw`
      SELECT create_coparent_message_with_attachments(
        ${ids.notificationMessage},${ids.familyA},${'GENERAL'},${'Notification test'},
        ARRAY[]::TEXT[],ARRAY[]::TEXT[]
      )`);
    const items = await asActor(ids.charlie, (tx) =>
      tx.notification.findMany({ where: { entityId: ids.notificationMessage } }),
    );
    expect(items).toHaveLength(1);
    expect(await asActor(ids.bob, (tx) => tx.notification.findMany({ where: { entityId: ids.notificationMessage } }))).toEqual([]);
    const marked = await asActor(ids.charlie, (tx) => tx.$queryRaw<Array<{ readAt: Date | null }>>`
      SELECT mark_coparent_notification_read(${items[0]!.id}) AS "readAt"`);
    expect(marked[0]?.readAt).toBeInstanceOf(Date);
    await asActor(ids.charlie, (tx) => tx.$queryRaw`
      SELECT set_coparent_notification_preference(${'NEW_MESSAGE'},${false},${false},${24}::INTEGER)`);
    await asActor(ids.alice, (tx) => tx.$queryRaw`
      SELECT create_coparent_message_with_attachments(
        ${ids.mutedNotificationMessage},${ids.familyA},${'GENERAL'},${'Muted notification test'},
        ARRAY[]::TEXT[],ARRAY[]::TEXT[]
      )`);
    expect(await asActor(ids.charlie, (tx) => tx.notification.count())).toBe(before + 1);
    await expect(
      admin.notification.update({ where: { id: items[0]!.id }, data: { title: 'Changed' } }),
    ).rejects.toThrow('Notification identity is immutable');
  });

  it('rejects invitation replay and expired invitations without revealing why', async () => {
    const [replay, expired] = await Promise.all([
      asActor(
        ids.charlie,
        (tx) =>
          tx.$queryRaw<unknown[]>`
          SELECT * FROM accept_coparent_family_invitation(${hashToken(tokens.valid)})
        `,
      ),
      asActor(
        ids.charlie,
        (tx) =>
          tx.$queryRaw<unknown[]>`
          SELECT * FROM accept_coparent_family_invitation(${hashToken(tokens.expired)})
        `,
      ),
    ]);
    expect(replay).toEqual([]);
    expect(expired).toEqual([]);
  });

  it('records a declined invitation without granting family access', async () => {
    const result = await asActor(
      ids.charlie,
      (tx) =>
        tx.$queryRaw<Array<{ invitationId: string; status: string }>>`
        SELECT * FROM decline_coparent_family_invitation(${hashToken(tokens.decline)})
      `,
    );
    expect(result).toEqual([
      { invitationId: ids.declinedInvitation, status: 'DECLINED' },
    ]);
    const membership = await admin.familyMembership.findUnique({
      where: {
        familyId_userId: { familyId: ids.familyB, userId: ids.charlie },
      },
    });
    expect(membership).toBeNull();
  });

  it('allows only the owner to atomically revoke an active invitation', async () => {
    const outsider = await asActor(
      ids.alice,
      (tx) =>
        tx.$queryRaw<unknown[]>`
        SELECT * FROM revoke_coparent_family_invitation(${ids.revokedInvitation}, ${ids.familyB})
      `,
    );
    expect(outsider).toEqual([]);

    const revoked = await asActor(
      ids.bob,
      (tx) =>
        tx.$queryRaw<
          Array<{ invitationId: string; familyId: string; status: string }>
        >`
          SELECT * FROM revoke_coparent_family_invitation(${ids.revokedInvitation}, ${ids.familyB})
      `,
    );
    expect(revoked).toEqual([
      {
        invitationId: ids.revokedInvitation,
        familyId: ids.familyB,
        status: 'REVOKED',
      },
    ]);

    const useRevokedToken = await asActor(
      ids.mallory,
      (tx) =>
        tx.$queryRaw<unknown[]>`
        SELECT * FROM accept_coparent_family_invitation(${hashToken(tokens.revoke)})
      `,
    );
    expect(useRevokedToken).toEqual([]);
  });
});
