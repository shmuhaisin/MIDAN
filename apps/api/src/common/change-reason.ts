import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Tx } from '../db/db.service';

/** Why a person changed an assessment draft. Optional, and kept with the change (supabase/migrations/20261107150000). */
export class ChangeReasonDto {
  @ApiPropertyOptional({ description: 'Why this change was made. Kept in the change history.' }) @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

/** Sets the reason for the draft changes this transaction makes, which the assessment audit trigger records. */
export async function recordChangeReason(tx: Tx, reason?: string) {
  await tx.$queryRaw`select set_config('midan.change_reason', ${reason?.trim() ?? ''}, true)`;
}
