import { Body, Controller, Post, UseGuards, Injectable, ExecutionContext } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ThrottlerGuard } from '@nestjs/throttler';
import { DbService } from '../db/db.service';

class InvitationContextDto {
  @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token!: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) email?: string;
}

@Injectable()
class InvitationIpThrottlerGuard extends ThrottlerGuard {
  protected generateKey(context: ExecutionContext, suffix: string, name: string) {
    // Separate key avoids double-counting the global guard's anonymous requests.
    return super.generateKey(context, `invitation-ip:${suffix}`, name);
  }
}

/** Anonymous onboarding proof, protected by the existing global throttle.
 * A secret token travels in a POST body; no recipient identity is returned.
 */
// Use the existing throttle's IP tracker too: an unverified Authorization header
// on this anonymous endpoint must not let callers vary the token-based tracker.
@UseGuards(InvitationIpThrottlerGuard)
@ApiTags('organization invitations')
@Controller('invitations')
export class InvitationContextController {
  constructor(private readonly db: DbService) {}
  @Post('context')
  inspect(@Body() body: InvitationContextDto) {
    return this.db.asAnon(async tx => {
      const [row] = await tx.$queryRaw<{ expires_at: Date }[]>`
        select public.inspect_organization_invitation(${body.token}, ${body.email ?? null}) as expires_at`;
      return row;
    });
  }
}
