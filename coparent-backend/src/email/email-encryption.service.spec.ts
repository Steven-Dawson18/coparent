import { EmailEncryptionService } from './email-encryption.service';

describe('EmailEncryptionService', () => {
  it('round-trips an invitation token without storing it as plaintext', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const service = new EmailEncryptionService({
      getOrThrow: jest.fn().mockReturnValue(key),
    } as never);
    const token = 'one-time-invitation-secret-value';

    const encrypted = service.encrypt({ token });

    expect(encrypted.ciphertext).not.toContain(token);
    expect(encrypted.initializationVector).not.toContain(token);
    expect(encrypted.authenticationTag).not.toContain(token);
    expect(service.decrypt<{ token: string }>(encrypted)).toEqual({ token });
  });

  it('rejects ciphertext authentication failures', () => {
    const key = Buffer.alloc(32, 8).toString('base64');
    const service = new EmailEncryptionService({
      getOrThrow: jest.fn().mockReturnValue(key),
    } as never);
    const encrypted = service.encrypt({ token: 'secret' });

    expect(() =>
      service.decrypt({ ...encrypted, ciphertext: 'AAAA' }),
    ).toThrow();
  });
});
