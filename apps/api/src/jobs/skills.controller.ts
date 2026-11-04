import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DbService } from '../db/db.service';

@ApiTags('skills')
@Controller('skills')
export class SkillsController {
  constructor(private readonly db: DbService) {}

  @Get()
  list() {
    return this.db.asAnon((tx) =>
      tx.skills.findMany({ select: { id: true, slug: true, name_ar: true, name_en: true, review_status: true }, orderBy: { slug: 'asc' } }),
    );
  }
}
