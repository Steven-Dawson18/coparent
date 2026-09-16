import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service';

interface ResendEmailEvent {
  type: string;
  data: { email_id?: string };
}

@Controller('webhooks/email')
export class ResendWebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('resend')
  @HttpCode(HttpStatus.NO_CONTENT)
  async handle(
    @Req() request: RawBodyRequest<Request>,
    @Headers('svix-id') id?: string,
    @Headers('svix-timestamp') timestamp?: string,
    @Headers('svix-signature') signature?: string,
  ) {
    if (this.config.get<string>('EMAIL_PROVIDER') !== 'resend') {
      throw new NotFoundException();
    }
    if (!request.rawBody || !id || !timestamp || !signature) {
      throw new UnauthorizedException();
    }

    let event: ResendEmailEvent;
    try {
      const resend = new Resend(
        this.config.getOrThrow<string>('RESEND_API_KEY'),
      );
      event = resend.webhooks.verify({
        payload: request.rawBody.toString('utf8'),
        headers: { id, timestamp, signature },
        webhookSecret: this.config.getOrThrow<string>(
          'RESEND_WEBHOOK_SIGNING_SECRET',
        ),
      }) as ResendEmailEvent;
    } catch {
      throw new UnauthorizedException();
    }

    if (event.data.email_id) {
      await this.prisma.$executeRaw`
        SELECT record_coparent_email_event(${event.data.email_id}, ${event.type})
      `;
    }
  }
}
