import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import {
  ExpenseActionController,
  ExpenseController,
} from './expense.controller';
import { ExpenseService } from './expense.service';

@Module({
  imports: [PrismaModule],
  controllers: [ExpenseController, ExpenseActionController],
  providers: [ExpenseService],
})
export class ExpenseModule {}
