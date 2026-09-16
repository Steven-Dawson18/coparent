import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FileStorageService, StoredEncryptedFile } from './file-storage';

@Injectable()
export class LocalEncryptedFileStorageService implements FileStorageService {
  private readonly key: Buffer;
  private readonly root: string;
  private readonly keyVersion = 1;

  constructor(config: ConfigService) {
    this.key = Buffer.from(
      config.getOrThrow<string>('FILE_STORAGE_ENCRYPTION_KEY'),
      'base64',
    );
    if (this.key.length !== 32)
      throw new Error('FILE_STORAGE_ENCRYPTION_KEY must decode to 32 bytes');
    this.root = resolve(config.getOrThrow<string>('FILE_STORAGE_ROOT'));
  }

  async store(plaintext: Buffer): Promise<StoredEncryptedFile> {
    const storageKey = `${randomUUID().slice(0, 2)}/${randomUUID()}.bin`;
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.key,
      initializationVector,
    );
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const path = this.path(storageKey);
    await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
    await writeFile(path, ciphertext, { flag: 'wx', mode: 0o600 });
    return {
      storageKey,
      initializationVector: initializationVector.toString('base64'),
      authenticationTag: cipher.getAuthTag().toString('base64'),
      encryptionKeyVersion: this.keyVersion,
      sha256: createHash('sha256').update(plaintext).digest('hex'),
      plaintextSize: plaintext.length,
    };
  }

  async read(file: StoredEncryptedFile): Promise<Buffer> {
    if (file.encryptionKeyVersion !== this.keyVersion)
      throw new Error('Unsupported document encryption key version');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(file.initializationVector, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(file.authenticationTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(await readFile(this.path(file.storageKey))),
      decipher.final(),
    ]);
    const digest = createHash('sha256').update(plaintext).digest('hex');
    if (digest !== file.sha256 || plaintext.length !== file.plaintextSize)
      throw new Error('Document integrity verification failed');
    return plaintext;
  }

  async remove(storageKey: string) {
    await rm(this.path(storageKey), { force: true });
  }

  private path(storageKey: string) {
    if (!/^[0-9a-f]{2}\/[0-9a-f-]{36}\.bin$/.test(storageKey))
      throw new Error('Invalid storage key');
    const path = resolve(this.root, storageKey);
    if (!path.startsWith(`${this.root}/`))
      throw new Error('Invalid storage key');
    return path;
  }
}
