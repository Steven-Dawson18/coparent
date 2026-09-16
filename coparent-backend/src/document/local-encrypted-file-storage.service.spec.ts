import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalEncryptedFileStorageService } from './local-encrypted-file-storage.service';

describe('LocalEncryptedFileStorageService', () => {
  let root: string;
  let service: LocalEncryptedFileStorageService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'coparent-documents-'));
    service = new LocalEncryptedFileStorageService(
      new ConfigService({
        FILE_STORAGE_ROOT: root,
        FILE_STORAGE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      }),
    );
  });

  afterEach(() => rm(root, { recursive: true, force: true }));

  it('stores ciphertext and verifies the plaintext on download', async () => {
    const plaintext = Buffer.from('sensitive child document');
    const metadata = await service.store(plaintext);
    const stored = await readFile(join(root, metadata.storageKey));
    expect(stored.equals(plaintext)).toBe(false);
    await expect(service.read(metadata)).resolves.toEqual(plaintext);
  });

  it('rejects ciphertext tampering', async () => {
    const metadata = await service.store(Buffer.from('original'));
    await writeFile(join(root, metadata.storageKey), Buffer.from('tampered'));
    await expect(service.read(metadata)).rejects.toThrow();
  });
});
