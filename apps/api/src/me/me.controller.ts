import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { AuthUser, DbService } from '../db/db.service';

class CandidateProfileDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) full_name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) headline?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() share_profile_consent?: boolean;
}

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly db: DbService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) =>
      tx.users.findUniqueOrThrow({
        where: { id: user.id },
        include: {
          candidate_profiles: true,
          organization_members: {
            select: { org_id: true, role: true, organizations: { select: { name_ar: true, name_en: true, is_demo: true } } },
          },
        },
      }),
    );
  }

  @Put('candidate-profile')
  upsertProfile(@CurrentUser() user: AuthUser, @Body() body: CandidateProfileDto) {
    const consent = body.share_profile_consent === undefined ? {} : { consent_updated_at: new Date() };
    return this.db.asUser(user, (tx) =>
      tx.candidate_profiles.upsert({
        where: { user_id: user.id },
        create: { ...body, ...consent, user_id: user.id },
        update: { ...body, ...consent },
      }),
    );
  }

  @Get('applications')
  applications(@CurrentUser() user: AuthUser) {
    return this.db.asUser(user, (tx) =>
      tx.applications.findMany({
        where: { candidate_id: user.id },
        orderBy: { created_at: 'desc' },
        include: {
          jobs: {
            select: {
              id: true, title_ar: true, title_en: true, is_demo: true,
              organizations: { select: { name_ar: true, name_en: true } },
            },
          },
        },
      }),
    );
  }
}
