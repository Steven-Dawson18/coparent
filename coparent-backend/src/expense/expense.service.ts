import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  CancelRecurringExpenseDto,
  CreateExpenseDto,
  CreateRecurringExpenseDto,
  ExpenseDto,
  RespondExpenseDto,
  ReviseExpenseDto,
} from './dto/expense.dto';

const versionSelect = {
  id: true,
  revision: true,
  category: true,
  title: true,
  description: true,
  amountMinor: true,
  currency: true,
  incurredOn: true,
  paidById: true,
  changedById: true,
  changeReason: true,
  createdAt: true,
  paidBy: { select: { id: true, firstName: true, lastName: true } },
  changedBy: { select: { id: true, firstName: true, lastName: true } },
  allocations: {
    orderBy: { userId: 'asc' as const },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  children: {
    include: {
      child: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  response: {
    include: {
      responder: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.ExpenseVersionSelect;

const expenseSelect = {
  id: true,
  familyId: true,
  createdById: true,
  respondentId: true,
  createdAt: true,
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  respondent: { select: { id: true, firstName: true, lastName: true } },
  currentVersion: { select: versionSelect },
} satisfies Prisma.ExpenseSelect;

const recurringSelect = {
  id: true,
  familyId: true,
  createdById: true,
  category: true,
  title: true,
  description: true,
  amountMinor: true,
  currency: true,
  frequency: true,
  startDate: true,
  endDate: true,
  paidById: true,
  createdAt: true,
  cancelledAt: true,
  cancelReason: true,
  paidBy: { select: { id: true, firstName: true, lastName: true } },
  allocations: {
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  children: {
    include: {
      child: { select: { id: true, firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.RecurringExpenseSelect;

@Injectable()
export class ExpenseService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, familyId: string) {
    return this.prisma.withActor(userId, (tx) =>
      tx.expense.findMany({
        where: { familyId },
        select: expenseSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      }),
    );
  }

  async create(userId: string, familyId: string, dto: CreateExpenseDto) {
    this.validate(dto);
    const expenseId = randomUUID(),
      versionId = randomUUID();
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ expenseId: string | null }>>`
      SELECT create_coparent_expense(${expenseId},${versionId},${familyId},${dto.respondentId},${dto.category},${dto.title},${dto.description ?? null},${dto.amountMinor}::INTEGER,${new Date(`${dto.incurredOn}T00:00:00Z`)}::DATE,${dto.paidById},${dto.allocations.map((a) => a.userId)}::TEXT[],${dto.allocations.map((a) => a.basisPoints)}::INTEGER[],${dto.childIds}::TEXT[]) AS "expenseId"`,
    );
    if (rows[0]?.expenseId !== expenseId) throw new NotFoundException();
    return this.get(userId, familyId, expenseId);
  }

  async revise(
    userId: string,
    familyId: string,
    expenseId: string,
    dto: ReviseExpenseDto,
  ) {
    this.validate(dto);
    const versionId = randomUUID();
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ expenseId: string | null }>>`
      SELECT revise_coparent_expense(${expenseId},${versionId},${familyId},${dto.category},${dto.title},${dto.description ?? null},${dto.amountMinor}::INTEGER,${new Date(`${dto.incurredOn}T00:00:00Z`)}::DATE,${dto.paidById},${dto.changeReason},${dto.allocations.map((a) => a.userId)}::TEXT[],${dto.allocations.map((a) => a.basisPoints)}::INTEGER[],${dto.childIds}::TEXT[]) AS "expenseId"`,
    );
    if (rows[0]?.expenseId !== expenseId) throw new NotFoundException();
    return this.get(userId, familyId, expenseId);
  }

  async respond(
    userId: string,
    familyId: string,
    expenseId: string,
    dto: RespondExpenseDto,
  ) {
    if (dto.responseType !== 'ACCEPT' && !dto.note?.trim())
      throw new BadRequestException(
        'A reason is required when declining or disputing an expense.',
      );
    const responseId = randomUUID();
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ expenseId: string | null }>>`
      SELECT respond_to_coparent_expense(${expenseId},${responseId},${familyId},${dto.responseType},${dto.note ?? null}) AS "expenseId"`,
    );
    if (rows[0]?.expenseId !== expenseId) throw new NotFoundException();
    return this.get(userId, familyId, expenseId);
  }

  async ledger(userId: string, familyId: string, childId?: string) {
    const accepted = await this.prisma.withActor(userId, (tx) =>
      tx.expense.findMany({
        where: {
          familyId,
          currentVersion: {
            response: { type: 'ACCEPT' },
            ...(childId && { children: { some: { childId } } }),
          },
        },
        select: expenseSelect,
        orderBy: { currentVersion: { incurredOn: 'desc' } },
        take: 500,
      }),
    );
    const balances = new Map<string, number>();
    for (const expense of accepted) {
      const version = expense.currentVersion;
      if (!version) continue;
      balances.set(
        version.paidById,
        (balances.get(version.paidById) ?? 0) + version.amountMinor,
      );
      for (const allocation of version.allocations)
        balances.set(
          allocation.userId,
          (balances.get(allocation.userId) ?? 0) - allocation.amountMinor,
        );
    }
    return {
      entries: accepted,
      balances: [...balances.entries()].map(([userId, amountMinor]) => ({
        userId,
        amountMinor,
      })),
    };
  }

  listRecurring(userId: string, familyId: string) {
    return this.prisma.withActor(userId, (tx) =>
      tx.recurringExpense.findMany({
        where: { familyId },
        select: recurringSelect,
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }

  async createRecurring(
    userId: string,
    familyId: string,
    dto: CreateRecurringExpenseDto,
  ) {
    this.validate(dto);
    if (dto.endDate && dto.endDate < dto.startDate)
      throw new BadRequestException(
        'Recurring expense end must not precede its start.',
      );
    const id = randomUUID();
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ recurringId: string | null }>>`
      SELECT create_coparent_recurring_expense(${id},${familyId},${dto.category},${dto.title},${dto.description ?? null},${dto.amountMinor}::INTEGER,${dto.frequency},${new Date(`${dto.startDate}T00:00:00Z`)}::DATE,${dto.endDate ? new Date(`${dto.endDate}T00:00:00Z`) : null}::DATE,${dto.paidById},${dto.allocations.map((a) => a.userId)}::TEXT[],${dto.allocations.map((a) => a.basisPoints)}::INTEGER[],${dto.childIds}::TEXT[]) AS "recurringId"`,
    );
    if (rows[0]?.recurringId !== id) throw new NotFoundException();
    return this.prisma.withActor(userId, (tx) =>
      tx.recurringExpense.findFirst({
        where: { id, familyId },
        select: recurringSelect,
      }),
    );
  }

  async cancelRecurring(
    userId: string,
    familyId: string,
    id: string,
    dto: CancelRecurringExpenseDto,
  ) {
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ recurringId: string | null }>>`
      SELECT cancel_coparent_recurring_expense(${id},${familyId},${dto.reason}) AS "recurringId"`,
    );
    if (rows[0]?.recurringId !== id) throw new NotFoundException();
    return { id };
  }

  async monthlySummary(userId: string, familyId: string, month: string) {
    const { start, end } = this.monthRange(month);
    const [schedules, actualExpenses, statements] = await this.prisma.withActor(
      userId,
      (tx) =>
        Promise.all([
          tx.recurringExpense.findMany({
            where: {
              familyId,
              startDate: { lt: end },
              OR: [{ endDate: null }, { endDate: { gte: start } }],
            },
            select: recurringSelect,
          }),
          tx.expense.findMany({
            where: {
              familyId,
              currentVersion: {
                incurredOn: { gte: start, lt: end },
                response: { type: 'ACCEPT' },
              },
            },
            select: expenseSelect,
          }),
          tx.monthlyExpenseStatement.findMany({
            where: { familyId, periodStart: start },
            orderBy: { createdAt: 'desc' },
          }),
        ]),
    );
    const occurrences = schedules.flatMap((schedule) =>
      this.occurrences(schedule, start, end),
    );
    const expectedByParent = new Map<string, number>();
    for (const occurrence of occurrences) {
      let allocated = 0;
      for (const [index, share] of occurrence.allocations.entries()) {
        const amount =
          index === occurrence.allocations.length - 1
            ? occurrence.amountMinor - allocated
            : Math.floor((occurrence.amountMinor * share.basisPoints) / 10000);
        allocated += amount;
        expectedByParent.set(
          share.userId,
          (expectedByParent.get(share.userId) ?? 0) + amount,
        );
      }
    }
    const actualPaidByParent = new Map<string, number>();
    for (const expense of actualExpenses)
      if (expense.currentVersion)
        actualPaidByParent.set(
          expense.currentVersion.paidById,
          (actualPaidByParent.get(expense.currentVersion.paidById) ?? 0) +
            expense.currentVersion.amountMinor,
        );
    return {
      month,
      periodStart: start.toISOString().slice(0, 10),
      periodEnd: end.toISOString().slice(0, 10),
      occurrences,
      actualExpenses,
      expectedTotalMinor: occurrences.reduce(
        (sum, item) => sum + item.amountMinor,
        0,
      ),
      actualPaidTotalMinor: actualExpenses.reduce(
        (sum, item) => sum + (item.currentVersion?.amountMinor ?? 0),
        0,
      ),
      expectedByParent: [...expectedByParent].map(([userId, amountMinor]) => ({
        userId,
        amountMinor,
      })),
      actualPaidByParent: [...actualPaidByParent].map(
        ([userId, amountMinor]) => ({ userId, amountMinor }),
      ),
      statement: statements[0] ?? null,
    };
  }

  async createStatement(userId: string, familyId: string, month: string) {
    const summary = await this.monthlySummary(userId, familyId, month);
    if (summary.statement) return summary.statement;
    const id = randomUUID();
    const snapshot = {
      ...summary,
      statement: undefined,
    } as Prisma.InputJsonValue;
    const serializedSnapshot = JSON.stringify(snapshot);
    const rows = await this.prisma.withActor(
      userId,
      (tx) => tx.$queryRaw<Array<{ statementId: string | null }>>`
      SELECT create_coparent_monthly_statement(${id},${familyId},${new Date(`${summary.periodStart}T00:00:00Z`)}::DATE,${new Date(`${summary.periodEnd}T00:00:00Z`)}::DATE,${summary.expectedTotalMinor}::INTEGER,${summary.actualPaidTotalMinor}::INTEGER,${serializedSnapshot}::JSONB) AS "statementId"`,
    );
    if (rows[0]?.statementId !== id) throw new NotFoundException();
    return { id, snapshot };
  }

  actionRequiredCount(userId: string) {
    return this.prisma.withActor(userId, async (tx) => ({
      count: await tx.expense.count({
        where: { respondentId: userId, currentVersion: { response: null } },
      }),
    }));
  }

  private validate(dto: ExpenseDto) {
    if (
      dto.allocations.reduce((sum, item) => sum + item.basisPoints, 0) !== 10000
    )
      throw new BadRequestException(
        'Expense allocations must total exactly 100%.',
      );
    if (
      new Set(dto.allocations.map((item) => item.userId)).size !==
      dto.allocations.length
    )
      throw new BadRequestException(
        'Each parent may appear only once in the split.',
      );
  }

  private async get(userId: string, familyId: string, expenseId: string) {
    const expense = await this.prisma.withActor(userId, (tx) =>
      tx.expense.findFirst({
        where: { id: expenseId, familyId },
        select: expenseSelect,
      }),
    );
    if (!expense) throw new NotFoundException();
    return expense;
  }

  private monthRange(month: string) {
    if (!/^\d{4}-\d{2}$/.test(month))
      throw new BadRequestException('Month must use YYYY-MM.');
    const start = new Date(`${month}-01T00:00:00Z`);
    if (Number.isNaN(start.getTime()))
      throw new BadRequestException('Invalid month.');
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return { start, end };
  }

  private occurrences(
    schedule: Prisma.RecurringExpenseGetPayload<{
      select: typeof recurringSelect;
    }>,
    start: Date,
    end: Date,
  ) {
    const results: Array<typeof schedule & { dueOn: string }> = [];
    const cancellationDate = schedule.cancelledAt
      ? new Date(schedule.cancelledAt.toISOString().slice(0, 10) + 'T00:00:00Z')
      : null;
    let due = new Date(schedule.startDate);
    let guard = 0;
    while (due < end && guard++ < 1000) {
      const activeEnd =
        schedule.endDate && schedule.endDate < end ? schedule.endDate : end;
      if (
        due >= start &&
        due <= activeEnd &&
        (!cancellationDate || due < cancellationDate)
      )
        results.push({ ...schedule, dueOn: due.toISOString().slice(0, 10) });
      const next = new Date(due);
      if (schedule.frequency === 'WEEKLY')
        next.setUTCDate(next.getUTCDate() + 7);
      else {
        const months =
          schedule.frequency === 'MONTHLY'
            ? 1
            : schedule.frequency === 'TERMLY'
              ? 4
              : 12;
        const day = next.getUTCDate();
        next.setUTCDate(1);
        next.setUTCMonth(next.getUTCMonth() + months);
        const last = new Date(
          Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
        ).getUTCDate();
        next.setUTCDate(Math.min(day, last));
      }
      due = next;
    }
    return results;
  }
}
