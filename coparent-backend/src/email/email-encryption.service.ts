import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedPayload {
  ciphertext: string;
  initializationVector: string;
  authenticationTag: string;
  keyVersion: number;
}

@Injectable()
export class EmailEncryptionService {
  private readonly key: Buffer;
  private readonly keyVersion = 1;

  constructor(config: ConfigService) {
    this.key = Buffer.from(
      config.getOrThrow<string>('EMAIL_OUTBOX_ENCRYPTION_KEY'),
      'base64',
    );
    if (this.key.length !== 32) {
      throw new Error('EMAIL_OUTBOX_ENCRYPTION_KEY must decode to 32 bytes');
    }
  }

  encrypt(value: object): EncryptedPayload {
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.key,
      initializationVector,
    );
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ]);
    return {
      ciphertext: ciphertext.toString('base64'),
      initializationVector: initializationVector.toString('base64'),
      authenticationTag: cipher.getAuthTag().toString('base64'),
      keyVersion: this.keyVersion,
    };
  }

  decrypt<T>(payload: EncryptedPayload): T {
    if (payload.keyVersion !== this.keyVersion) {
      throw new Error('Unsupported email outbox key version');
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(payload.initializationVector, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(payload.authenticationTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  }
}
