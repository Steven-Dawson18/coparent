import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../types/authenticated-user';
import {
  CancelRecurringExpenseDto,
  CreateExpenseDto,
  CreateRecurringExpenseDto,
  RespondExpenseDto,
  ReviseExpenseDto,
} from './dto/expense.dto';
import { ExpenseService } from './expense.service';

interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

@UseGuards(AuthGuard('jwt'))
@Controller('families/:familyId/expenses')
export class ExpenseController {
  constructor(private readonly expenses: ExpenseService) {}
  @Get() list(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
  ) {
    return this.expenses.list(r.user.userId, f);
  }
  @Get('ledger') ledger(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
    @Query('childId') childId?: string,
  ) {
    return this.expenses.ledger(r.user.userId, f, childId);
  }
  @Get('monthly-summary') monthly(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
    @Query('month') month: string,
  ) {
    return this.expenses.monthlySummary(r.user.userId, f, month);
  }
  @Get('recurring') recurring(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
  ) {
    return this.expenses.listRecurring(r.user.userId, f);
  }
  @Post('recurring') createRecurring(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
    @Body() d: CreateRecurringExpenseDto,
  ) {
    return this.expenses.createRecurring(r.user.userId, f, d);
  }
  @Post('recurring/:recurringId/cancel') cancelRecurring(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
    @Param('recurringId') id: string,
    @Body() d: CancelRecurringExpenseDto,
  ) {
    return this.expenses.cancelRecurring(r.user.userId, f, id, d);
  }
  @Post('monthly-statements') statement(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
    @Body('month') month: string,
  ) {
    return this.expenses.createStatement(r.user.userId, f, month);
  }
  @Post() create(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
    @Body() d: CreateExpenseDto,
  ) {
    return this.expenses.create(r.user.userId, f, d);
  }
  @Patch(':expenseId') revise(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
    @Param('expenseId') id: string,
    @Body() d: ReviseExpenseDto,
  ) {
    return this.expenses.revise(r.user.userId, f, id, d);
  }
  @Post(':expenseId/respond') respond(
    @Request() r: AuthenticatedRequest,
    @Param('familyId') f: string,
    @Param('expenseId') id: string,
    @Body() d: RespondExpenseDto,
  ) {
    return this.expenses.respond(r.user.userId, f, id, d);
  }
}

@UseGuards(AuthGuard('jwt'))
@Controller('expenses')
export class ExpenseActionController {
  constructor(private readonly expenses: ExpenseService) {}
  @Get('action-required-count') count(@Request() r: AuthenticatedRequest) {
    return this.expenses.actionRequiredCount(r.user.userId);
  }
}
