import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { defer, Observable } from 'rxjs';
import {
  RequestProfessionalScope,
  RequestSecurityContext,
} from './request-security-context.service';

const routeScopes: Array<[RegExp, RequestProfessionalScope]> = [
  [/\/(?:messages)(?:\/|\?|$)/, 'MESSAGES'],
  [/\/(?:requests)(?:\/|\?|$)/, 'REQUESTS'],
  [/\/(?:agreements)(?:\/|\?|$)/, 'AGREEMENTS'],
  [/\/(?:calendar-events|living-arrangements)(?:\/|\?|$)/, 'CALENDAR'],
  [/\/(?:handovers)(?:\/|\?|$)/, 'HANDOVERS'],
  [/\/(?:expenses)(?:\/|\?|$)/, 'EXPENSES'],
  [/\/(?:documents)(?:\/|\?|$)/, 'DOCUMENTS'],
  [/\/(?:audit-events)(?:\/|\?|$)/, 'AUDIT'],
  [/\/(?:evidence-export|evidence-package|legal)(?:\/|\?|$)/, 'EVIDENCE'],
];

@Injectable()
export class ProfessionalScopeInterceptor implements NestInterceptor {
  constructor(private readonly context: RequestSecurityContext) {}

  intercept(
    execution: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = execution.switchToHttp().getRequest<Request>();
    const path = request.originalUrl.toLowerCase();
    const scope =
      routeScopes.find(([pattern]) => pattern.test(path))?.[1] ??
      (path.startsWith('/families/') || path.startsWith('/professional/')
        ? 'CASE_OVERVIEW'
        : null);
    return defer(() => this.context.run(scope, () => next.handle()));
  }
}
