import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApplicationsController } from './applications/applications.controller';
import { TokenThrottlerGuard } from './common/token-throttler.guard';
import { AiClient } from './ai/ai.client';
import { AssessmentsController } from './assessments/assessments.controller';
import { AttemptsController } from './attempts/attempts.controller';
import { DbModule } from './db/db.module';
import { EvaluationsController } from './evaluations/evaluations.controller';
import { RequirementsController } from './jobs/requirements.controller';
import { SkillsController } from './jobs/skills.controller';
import { HealthController } from './health.controller';
import { JobsController } from './jobs/jobs.controller';
import { InterviewsController } from './interviews/interviews.controller';
import { CalendarClient, DailyClient } from './interviews/video-and-calendar';
import { CandidateController } from './me/candidate.controller';
import { CareerController, ReferenceController } from './me/career.controller';
import { CvController } from './me/cv.controller';
import { MeController } from './me/me.controller';
import { OrganizationsController } from './organizations/organizations.controller';

@Module({
  imports: [DbModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }])],
  providers: [AiClient, DailyClient, CalendarClient, CvController, { provide: APP_GUARD, useClass: TokenThrottlerGuard }],
  controllers: [
    HealthController, JobsController, SkillsController, OrganizationsController, ApplicationsController, MeController,
    AssessmentsController, AttemptsController, EvaluationsController, RequirementsController,
    CandidateController, CvController, CareerController, ReferenceController, InterviewsController,
  ],
})
export class AppModule {}
