import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminController, PlatformAdminGuard } from './admin/admin.controller';
import { AdminEmployerAccessController, MyEmployerAccessController } from './admin/employer-access.controller';
import { AdminOrganizationsController } from './admin/admin-organizations.controller';
import { ApplicationsController } from './applications/applications.controller';
import { ApplicationReviewController } from './applications/review.controller';
import { ApplicationMatchController } from './applications/match.controller';
import { JobRankingController } from './applications/ranking.controller';
import { CvMatchStore } from './applications/cv-match-store';
import { DevelopmentReportController } from './applications/development.controller';
import { AssistantController } from './assistant/assistant.controller';
import { BackgroundWorker } from './jobs-queue/worker';
import { TokenThrottlerGuard } from './common/token-throttler.guard';
import { AiClient } from './ai/ai.client';
import { AssessmentsController } from './assessments/assessments.controller';
import { AttemptsController } from './attempts/attempts.controller';
import { DbModule } from './db/db.module';
import { EvaluationsController } from './evaluations/evaluations.controller';
import { RequirementsController } from './jobs/requirements.controller';
import { JobAnalysisController } from './jobs/analysis.controller';
import { JobSkillsController } from './jobs/job-skills.controller';
import { TranslationController } from './jobs/translation.controller';
import { SkillsController } from './jobs/skills.controller';
import { HealthController } from './health.controller';
import { JobsController } from './jobs/jobs.controller';
import { InterviewsController } from './interviews/interviews.controller';
import { InterviewPreparationController } from './interviews/preparation.controller';
import { CalendarClient, DailyClient } from './interviews/video-and-calendar';
import { CandidateController } from './me/candidate.controller';
import { CareerController, ReferenceController } from './me/career.controller';
import { ReadinessController } from './me/readiness.controller';
import { CvController } from './me/cv.controller';
import { MeController } from './me/me.controller';
import { OrganizationsController } from './organizations/organizations.controller';

import { EmployerClaimsController } from './organizations/employer-claims.controller';
import { OrganizationVerificationController } from './organizations/organization-verification.controller';
import { OrganizationListingsController } from './organizations/organization-listings.controller';
import { MyInvitationsController, TeamController } from './organizations/team.controller';

@Module({
  imports: [DbModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }])],
  providers: [AiClient, CvMatchStore, DailyClient, CalendarClient, CvController, BackgroundWorker, PlatformAdminGuard, { provide: APP_GUARD, useClass: TokenThrottlerGuard }],
  controllers: [
    HealthController, JobsController, SkillsController, OrganizationsController, ApplicationsController, ApplicationReviewController, ApplicationMatchController, JobRankingController, DevelopmentReportController, AssistantController, MeController,
    AssessmentsController, AttemptsController, EvaluationsController, RequirementsController,
    CandidateController, CvController, CareerController, ReadinessController, ReferenceController, InterviewsController, InterviewPreparationController, AdminController, AdminEmployerAccessController, MyEmployerAccessController, JobAnalysisController, JobSkillsController,
    TeamController, MyInvitationsController, EmployerClaimsController, OrganizationListingsController,
    OrganizationVerificationController, AdminOrganizationsController, TranslationController,
  ],
})
export class AppModule {}
