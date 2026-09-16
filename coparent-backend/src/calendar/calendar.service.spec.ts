import { BadRequestException } from '@nestjs/common';
import { CalendarService } from './calendar.service';

describe('CalendarService validation', () => {
  const service = new CalendarService({} as never);

  it('rejects an end before the start', async () => {
    await expect(
      service.create('user', 'family', {
        category: 'GENERAL',
        title: 'Invalid',
        startsAt: '2026-08-28T12:00:00Z',
        endsAt: '2026-08-28T11:00:00Z',
        timeZone: 'Europe/London',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown timezone before accessing the database', async () => {
    await expect(
      service.create('user', 'family', {
        category: 'GENERAL',
        title: 'Invalid',
        startsAt: '2026-08-28T11:00:00Z',
        endsAt: '2026-08-28T12:00:00Z',
        timeZone: 'Not/A_Timezone',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
