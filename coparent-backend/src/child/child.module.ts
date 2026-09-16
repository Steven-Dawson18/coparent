import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChildController } from './child.controller';
import { ChildService } from './child.service';

@Module({
  imports: [PrismaModule],
  controllers: [ChildController],
  providers: [ChildService],
})
export class ChildModule {}
