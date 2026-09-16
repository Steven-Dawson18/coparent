export interface StoredEncryptedFile {
  storageKey: string;
  initializationVector: string;
  authenticationTag: string;
  encryptionKeyVersion: number;
  sha256: string;
  plaintextSize: number;
}

export interface FileStorageService {
  store(plaintext: Buffer): Promise<StoredEncryptedFile>;
  read(file: StoredEncryptedFile): Promise<Buffer>;
  remove(storageKey: string): Promise<void>;
}

export const FILE_STORAGE_SERVICE = Symbol('FILE_STORAGE_SERVICE');
