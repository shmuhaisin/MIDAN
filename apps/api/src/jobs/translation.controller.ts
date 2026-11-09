// Automatic Arabic <-> English translation of a job's bilingual fields (employer brief, section 7). The web page asks as
// the employer types; the translation is a proposal shown in the other field and saved only when the employer saves the
// form, so both languages stay reviewable and editable. Nothing is published automatically.
import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsIn, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { AiClient } from '../ai/ai.client';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import { BUILDERS, requireRole } from '../common/roles';
import { AuthUser, DbService } from '../db/db.service';

class TranslateFieldDto {
  @ApiProperty() @IsString() @Matches(/^[a-z0-9_:.-]{1,60}$/) key!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(8000) text!: string;
}

class TranslateDto {
  @ApiProperty({ enum: ['ar', 'en'] }) @IsIn(['ar', 'en']) source!: 'ar' | 'en';
  @ApiProperty({ enum: ['ar', 'en'] }) @IsIn(['ar', 'en']) target!: 'ar' | 'en';
  @ApiProperty({ type: [TranslateFieldDto] }) @ValidateNested({ each: true }) @Type(() => TranslateFieldDto) @ArrayMinSize(1) @ArrayMaxSize(12) fields!: TranslateFieldDto[];
}

@ApiTags('jobs')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('organizations/:orgId/translate')
export class TranslationController {
  constructor(private readonly db: DbService, private readonly ai: AiClient) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Translates job fields between Arabic and English with the live model. { ok: false, reason } when no model answered: never invented text.',
  })
  async translate(@CurrentUser() user: AuthUser, @Param('orgId', ParseUUIDPipe) orgId: string, @Body() body: TranslateDto) {
    await this.db.asUser(user, (tx) => requireRole(tx, user, orgId, BUILDERS));
    return this.ai.translate({ source: body.source, target: body.target, fields: body.fields.map((f) => ({ key: f.key, text: f.text })) });
  }
}
