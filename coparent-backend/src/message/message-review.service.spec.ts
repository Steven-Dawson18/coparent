import { NotFoundException } from '@nestjs/common';
import { MessageReviewService } from './message-review.service';

function createService(
  role: 'OWNER' | 'PARENT' | 'PROFESSIONAL_READ_ONLY' | null = 'PARENT',
) {
  const findUnique = jest
    .fn()
    .mockResolvedValue(
      role ? { role, revokedAt: null, accessExpiresAt: null } : null,
    );
  const transactionClient = { familyMembership: { findUnique } };
  const prisma = {
    withActor: jest.fn(
      (_userId: string, callback: (tx: typeof transactionClient) => unknown) =>
        callback(transactionClient),
    ),
  };
  return {
    service: new MessageReviewService(prisma as never),
    prisma,
    findUnique,
  };
}

describe('MessageReviewService', () => {
  it('returns a clear result for practical neutral wording', async () => {
    const { service } = createService();

    await expect(
      service.review('parent-a', 'family-a', {
        body: 'Could you confirm whether the school collection can move to 16:00 on Friday?',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        reviewRecommended: false,
        tone: 'CLEAR',
        signals: [],
        suggestedBody: null,
      }),
    );
  });

  it('identifies escalation patterns and offers only an optional conservative revision', async () => {
    const { service } = createService('OWNER');

    const result = await service.review('parent-a', 'family-a', {
      body: 'You NEVER confirm collection times!!! This is your fault.',
    });

    expect(result.reviewRecommended).toBe(true);
    expect(result.tone).toBe('MAY_ESCALATE');
    expect(result.signals.map((signal) => signal.code)).toEqual(
      expect.arrayContaining([
        'ABSOLUTE_LANGUAGE',
        'BLAME_LANGUAGE',
        'REPEATED_PUNCTUATION',
      ]),
    );
    expect(result.suggestedBody).toBe(
      'I am concerned that you do not confirm collection times! This situation needs resolving.',
    );
  });

  it('conceals the review endpoint from read-only professionals', async () => {
    const { service } = createService('PROFESSIONAL_READ_ONLY');

    await expect(
      service.review('professional-a', 'family-a', {
        body: 'Please review this.',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
