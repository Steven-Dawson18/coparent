import { ConfigService } from '@nestjs/config';
import { ResendEmailProvider } from './resend-email.provider';

describe('ResendEmailProvider', () => {
  it('can be constructed in development mode without Resend credentials', async () => {
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    const provider = new ResendEmailProvider(config);

    await expect(
      provider.sendInvitation({
        jobId: 'job-id',
        recipient: 'recipient@example.test',
        role: 'PARENT',
        token: 'secret',
        expiresAt: new Date('2026-08-28T12:00:00Z'),
      }),
    ).rejects.toThrow('resend_delivery_failed');
  });
});
