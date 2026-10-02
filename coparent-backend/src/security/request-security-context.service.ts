import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestProfessionalScope =
  | 'CASE_OVERVIEW'
  | 'MESSAGES'
  | 'REQUESTS'
  | 'AGREEMENTS'
  | 'CALENDAR'
  | 'HANDOVERS'
  | 'EXPENSES'
  | 'DOCUMENTS'
  | 'AUDIT'
  | 'EVIDENCE';

@Injectable()
export class RequestSecurityContext {
  private readonly storage = new AsyncLocalStorage<{
    professionalScope: RequestProfessionalScope | null;
  }>();

  run<T>(
    professionalScope: RequestProfessionalScope | null,
    callback: () => T,
  ): T {
    return this.storage.run({ professionalScope }, callback);
  }

  get professionalScope() {
    return this.storage.getStore()?.professionalScope ?? null;
  }
}
