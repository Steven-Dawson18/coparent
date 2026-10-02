import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewMessageDto } from './dto/review-message.dto';

export type MessageReviewSignalCode =
  | 'ABSOLUTE_LANGUAGE'
  | 'BLAME_LANGUAGE'
  | 'HOSTILE_LABEL'
  | 'THREATENING_LANGUAGE'
  | 'REPEATED_PUNCTUATION'
  | 'EXCESSIVE_CAPITALS'
  | 'LONG_MESSAGE';

export interface MessageReviewSignal {
  code: MessageReviewSignalCode;
  title: string;
  explanation: string;
}

export interface MessageReviewResult {
  reviewRecommended: boolean;
  tone: 'CLEAR' | 'MAY_ESCALATE';
  signals: MessageReviewSignal[];
  suggestions: string[];
  suggestedBody: string | null;
  notice: string;
}

const notice =
  'This automated wording check looks only for common escalation patterns. It does not judge facts, intent, or who is right.';

@Injectable()
export class MessageReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async review(
    userId: string,
    familyId: string,
    dto: ReviewMessageDto,
  ): Promise<MessageReviewResult> {
    const canWrite = await this.prisma.withActor(userId, async (tx) => {
      const membership = await tx.familyMembership.findUnique({
        where: { familyId_userId: { familyId, userId } },
        select: { role: true, revokedAt: true, accessExpiresAt: true },
      });
      return (
        !!membership &&
        !membership.revokedAt &&
        (!membership.accessExpiresAt ||
          membership.accessExpiresAt > new Date()) &&
        (membership.role === 'OWNER' || membership.role === 'PARENT')
      );
    });
    if (!canWrite) throw new NotFoundException();

    return this.analyse(dto.body.trim());
  }

  analyse(body: string): MessageReviewResult {
    const signals: MessageReviewSignal[] = [];
    const suggestions: string[] = [];

    if (/\byou\s+(always|never)\b/i.test(body)) {
      signals.push({
        code: 'ABSOLUTE_LANGUAGE',
        title: 'Absolute wording',
        explanation:
          'Words such as “always” or “never” can make a practical issue feel like a personal accusation.',
      });
      suggestions.push(
        'Describe the specific event, date, or arrangement instead of a general pattern.',
      );
    }
    if (
      /\b(your fault|because of you|you (?:do not|don['’]t|dont) care)\b/i.test(
        body,
      )
    ) {
      signals.push({
        code: 'BLAME_LANGUAGE',
        title: 'Blame-focused wording',
        explanation:
          'Focusing on the problem and the next action may make a useful response more likely.',
      });
      suggestions.push(
        'State the effect on the child or arrangement and ask for a concrete next step.',
      );
    }
    if (
      /\b(idiot|stupid|liar|pathetic|useless|selfish|crazy|narcissist)\b/i.test(
        body,
      )
    ) {
      signals.push({
        code: 'HOSTILE_LABEL',
        title: 'Personal label',
        explanation:
          'A personal label can distract from the child-related issue that needs resolving.',
      });
      suggestions.push(
        'Remove personal labels and describe only the observable event or behaviour.',
      );
    }
    if (
      /\b(or else|you(?:'|’)?ll regret|you will regret|i(?:'|’)?ll make you|i will make you)\b/i.test(
        body,
      )
    ) {
      signals.push({
        code: 'THREATENING_LANGUAGE',
        title: 'Threatening wording',
        explanation:
          'Threats and ultimatums are likely to escalate the exchange.',
      });
      suggestions.push(
        'Replace the ultimatum with the outcome you need and a reasonable response time.',
      );
    }
    if (/[!?]{3,}/.test(body)) {
      signals.push({
        code: 'REPEATED_PUNCTUATION',
        title: 'Emphatic punctuation',
        explanation:
          'Repeated punctuation can make neutral text read as confrontational.',
      });
      suggestions.push('Use a single question mark or full stop.');
    }

    const words = body.match(/[A-Za-z]{3,}/g) ?? [];
    const uppercaseWords = words.filter((word) => word === word.toUpperCase());
    if (words.length >= 4 && uppercaseWords.length / words.length >= 0.35) {
      signals.push({
        code: 'EXCESSIVE_CAPITALS',
        title: 'Capital letters',
        explanation: 'Several capitalised words can read as shouting.',
      });
      suggestions.push(
        'Use normal sentence case and reserve capitals for names or abbreviations.',
      );
    }
    if (body.length > 1500) {
      signals.push({
        code: 'LONG_MESSAGE',
        title: 'Long message',
        explanation:
          'A long message can make the action being requested difficult to identify.',
      });
      suggestions.push(
        'Lead with the requested action, then keep supporting facts brief and dated.',
      );
    }

    const suggestedBody = this.createConservativeSuggestion(body);
    return {
      reviewRecommended: signals.length > 0,
      tone: signals.length > 0 ? 'MAY_ESCALATE' : 'CLEAR',
      signals,
      suggestions: [...new Set(suggestions)],
      suggestedBody: suggestedBody === body ? null : suggestedBody,
      notice,
    };
  }

  private createConservativeSuggestion(body: string) {
    return body
      .replace(/\byou always\b/gi, 'I have noticed that you')
      .replace(/\byou never\b/gi, 'I am concerned that you do not')
      .replace(/\bthis is your fault\b/gi, 'This situation needs resolving')
      .replace(
        /\byou (?:do not|don['’]t|dont) care\b/gi,
        'I do not feel this has been addressed',
      )
      .replace(/\bor else\b/gi, 'so that we can agree the next step')
      .replace(/!{2,}/g, '!')
      .replace(/\?{2,}/g, '?')
      .trim();
  }
}
