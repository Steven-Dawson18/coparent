import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { FILE_STORAGE_SERVICE } from './file-storage';
import { LocalEncryptedFileStorageService } from './local-encrypted-file-storage.service';

@Module({
  imports: [PrismaModule],
  controllers: [DocumentController],
  providers: [
    DocumentService,
    LocalEncryptedFileStorageService,
    {
      provide: FILE_STORAGE_SERVICE,
      useExisting: LocalEncryptedFileStorageService,
    },
  ],
})
export class DocumentModule {}
