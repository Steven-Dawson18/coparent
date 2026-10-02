import { lastValueFrom, of } from 'rxjs';
import { ProfessionalScopeInterceptor } from './professional-scope.interceptor';

describe('ProfessionalScopeInterceptor', () => {
  it.each([
    ['/families/family-a/messages', 'MESSAGES'],
    ['/families/family-a/expenses/ledger', 'EXPENSES'],
    ['/families/family-a/legal/disclosures/disclosure-a/bundle', 'EVIDENCE'],
    ['/families/family-a', 'CASE_OVERVIEW'],
    ['/notifications', null],
  ])('binds %s to %s', async (originalUrl, expected) => {
    const run = jest.fn((_scope, callback: () => unknown) => callback());
    const interceptor = new ProfessionalScopeInterceptor({ run } as never);
    const execution = {
      switchToHttp: () => ({ getRequest: () => ({ originalUrl }) }),
    } as never;
    await expect(
      lastValueFrom(
        interceptor.intercept(execution, { handle: () => of('ok') }),
      ),
    ).resolves.toBe('ok');
    expect(run).toHaveBeenCalledWith(expected, expect.any(Function));
  });
});
