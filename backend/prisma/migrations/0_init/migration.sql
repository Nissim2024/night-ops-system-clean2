-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'RELEASE_MANAGER', 'CR_MANAGER', 'TEAM_LEAD', 'EMPLOYEE', 'VIEWER');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'WAITING', 'DONE', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'CR_REVIEW', 'COLLECTING', 'REFINING', 'REVIEW', 'APPROVED', 'REHEARSAL', 'ACTIVE', 'MORNING_AFTER', 'COMPLETED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('HOT', 'HOTNET', 'BOTH');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('NOT_TESTED', 'PASSED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'READY');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NEEDS_REVISION');

-- CreateEnum
CREATE TYPE "CrPlanSubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "SkillType" AS ENUM ('Professional', 'Applications', 'Tools', 'Personal', 'Business');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "apps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "requiresPlan" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "isLead" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("userId","teamId")
);

-- CreateTable
CREATE TABLE "Version" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "collectionDeadline" TIMESTAMP(3),
    "reviewMeetingTime" TIMESTAMP(3),
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "importedFileName" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "lastRehearsalSnapshot" JSONB,
    "lastRehearsalAt" TIMESTAMP(3),
    "lastNightSnapshot" JSONB,
    "lastNightAt" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "wizardState" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "qcReleaseId" TEXT,

    CONSTRAINT "Version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Phase" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "teamId" TEXT,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'BOTH',
    "isGoNoGo" BOOLEAN NOT NULL DEFAULT false,
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Phase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubPhase" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "crNumber" TEXT,
    "application" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "assignedTeamId" TEXT,
    "assignedUserId" TEXT,
    "assignedUserName" TEXT,
    "blockedReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdByTeamLead" TEXT,
    "environment" "Environment" NOT NULL DEFAULT 'BOTH',
    "executionStatus" "ExecutionStatus" NOT NULL DEFAULT 'NOT_TESTED',
    "followupNotes" TEXT,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "isCriticalForGo" BOOLEAN NOT NULL DEFAULT false,
    "lastEditedAt" TIMESTAMP(3),
    "lastEditedBy" TEXT,
    "morningFollowup" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "dependencyNote" TEXT,
    "duration" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualFinish" TIMESTAMP(3),
    "delayReason" TEXT,
    "subPhaseId" TEXT,
    "testerInNight" TEXT,
    "testerInVersion" TEXT,
    "versionId" TEXT,
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "goNoGoWaived" BOOLEAN NOT NULL DEFAULT false,
    "waivedBy" TEXT,
    "waivedAt" TIMESTAMP(3),
    "failedReason" TEXT,
    "failureReasonId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("taskId","dependsOnTaskId")
);

-- CreateTable
CREATE TABLE "TeamSubmission" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "submittedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "taskCount" INTEGER NOT NULL DEFAULT 0,
    "notRequiredForApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,
    "action" TEXT NOT NULL,
    "beforeData" JSONB,
    "afterData" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermissions" (
    "role" "Role" NOT NULL,
    "permissions" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RolePermissions_pkey" PRIMARY KEY ("role")
);

-- CreateTable
CREATE TABLE "RehearsalSummary" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "headline" TEXT,
    "morningNotes" TEXT,
    "crData" JSONB,
    "sentAt" TIMESTAMP(3),
    "sentBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RehearsalSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailRecipient" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QcRelease" (
    "id" TEXT NOT NULL,
    "relId" INTEGER NOT NULL,
    "relParentId" INTEGER,
    "relName" TEXT NOT NULL,
    "relStartDate" TIMESTAMP(3),
    "relEndDate" TIMESTAMP(3),
    "relTeam" TEXT,
    "goLiveCycleId" INTEGER,
    "goLiveDate" TIMESTAMP(3),
    "rehearsalCycleId" INTEGER,
    "rehearsalDate" TIMESTAMP(3),
    "filterDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QcRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersionTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "structure" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VersionTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskProposal" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "app" TEXT,
    "estimatedMins" INTEGER,
    "crNumber" TEXT,
    "notes" TEXT,
    "assignedUserName" TEXT,
    "crLabel" TEXT,
    "phase" INTEGER NOT NULL,
    "system" TEXT,
    "actionType" TEXT,
    "subPhaseId" TEXT,
    "responsibleTeamId" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "usedInTaskId" TEXT,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrPlan" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "crNumber" TEXT NOT NULL,
    "crLabel" TEXT,
    "crManager" TEXT,
    "crDescription" TEXT,
    "crType" TEXT,
    "riskLevel" TEXT,
    "systems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "planApproved" BOOLEAN NOT NULL DEFAULT false,
    "planApprovedAt" TIMESTAMP(3),
    "workPlan" TEXT,
    "scripts" TEXT,
    "runTimes" TEXT,
    "rollbackPlan" TEXT,
    "gradualRollout" BOOLEAN NOT NULL DEFAULT false,
    "gradualDetails" TEXT,
    "nightTestingNotes" TEXT,
    "morningMonitoring" TEXT,
    "notNeededForPlan" BOOLEAN NOT NULL DEFAULT false,
    "submissionStatus" "CrPlanSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "submittedByName" TEXT,
    "returnReason" TEXT,
    "returnedAt" TIMESTAMP(3),
    "approvedByName" TEXT,
    "reviewNote" TEXT,
    "crManagerApproved" BOOLEAN NOT NULL DEFAULT false,
    "crManagerApprovedAt" TIMESTAMP(3),
    "crManagerApprovedBy" TEXT,
    "crManagerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrDependency" (
    "id" TEXT NOT NULL,
    "crPlanId" TEXT NOT NULL,
    "dependsOnCr" TEXT NOT NULL,

    CONSTRAINT "CrDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NightSummary" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "headline" TEXT,
    "morningNotes" TEXT,
    "crData" JSONB,
    "recipientsSnapshot" JSONB,
    "sentAt" TIMESTAMP(3),
    "sentBy" TEXT,
    "forceApprovedBy" TEXT,
    "forceApprovedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NightSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FailureReason" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requiresRollback" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FailureReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemParam" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SystemParam_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "VersionCrAssignment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "crNumber" TEXT NOT NULL,
    "crLabel" TEXT,
    "teamId" TEXT NOT NULL,
    "crManager" TEXT,
    "crDescription" TEXT,
    "application" TEXT,
    "project" TEXT,
    "qaEffort" DOUBLE PRECISION,
    "qaEffortOverride" DOUBLE PRECISION,
    "requiredSkillMinLevel" INTEGER,
    "isStandAlone" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VersionCrAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dateRange" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonDate" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SeasonDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seasonId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SkillType" NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TesterProfile" (
    "userId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TesterProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "TesterSkill" (
    "userId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TesterSkill_pkey" PRIMARY KEY ("userId","skillId")
);

-- CreateTable
CREATE TABLE "QaAssignment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "crNumber" TEXT NOT NULL,
    "crLabel" TEXT,
    "application" TEXT,
    "userId" TEXT NOT NULL,
    "qaEffort" DOUBLE PRECISION,
    "autoScore" INTEGER,
    "notes" TEXT,
    "assignedBy" TEXT,
    "isStandAlone" BOOLEAN,
    "cycles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaWorkPlan" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "cycle1Start" TIMESTAMP(3) NOT NULL,
    "testingEnd" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaWorkPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaCycle" (
    "id" TEXT NOT NULL,
    "workPlanId" TEXT NOT NULL,
    "cycleType" TEXT NOT NULL,
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "plannedEnd" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaCycleTask" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "crNumber" TEXT NOT NULL,
    "crLabel" TEXT,
    "taskType" TEXT NOT NULL DEFAULT 'CR',
    "userId" TEXT NOT NULL,
    "effortDays" DOUBLE PRECISION NOT NULL,
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "plannedEnd" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QaCycleTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityBoardEntry" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "activityKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "owner" TEXT NOT NULL DEFAULT '',
    "ownerEmployee" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "attendees" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT NOT NULL DEFAULT 'other',
    "dateStart" TIMESTAMP(3),
    "dateEnd" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isRelevant" BOOLEAN NOT NULL DEFAULT true,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityBoardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunbookEntry" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "runbookId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "employee" TEXT NOT NULL DEFAULT '',
    "startTime" TEXT NOT NULL DEFAULT '',
    "endTime" TEXT NOT NULL DEFAULT '',
    "team" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunbookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "TeamSubmission_versionId_teamId_key" ON "TeamSubmission"("versionId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "RehearsalSummary_versionId_key" ON "RehearsalSummary"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailRecipient_email_key" ON "EmailRecipient"("email");

-- CreateIndex
CREATE UNIQUE INDEX "QcRelease_relId_key" ON "QcRelease"("relId");

-- CreateIndex
CREATE UNIQUE INDEX "CrPlan_versionId_teamId_crNumber_key" ON "CrPlan"("versionId", "teamId", "crNumber");

-- CreateIndex
CREATE UNIQUE INDEX "NightSummary_versionId_key" ON "NightSummary"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "FailureReason_reason_key" ON "FailureReason"("reason");

-- CreateIndex
CREATE UNIQUE INDEX "VersionCrAssignment_versionId_crNumber_teamId_key" ON "VersionCrAssignment"("versionId", "crNumber", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE UNIQUE INDEX "QaAssignment_versionId_crNumber_key" ON "QaAssignment"("versionId", "crNumber");

-- CreateIndex
CREATE UNIQUE INDEX "QaWorkPlan_versionId_key" ON "QaWorkPlan"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityBoardEntry_versionId_activityKey_key" ON "ActivityBoardEntry"("versionId", "activityKey");

-- CreateIndex
CREATE UNIQUE INDEX "RunbookEntry_versionId_runbookId_stepIndex_key" ON "RunbookEntry"("versionId", "runbookId", "stepIndex");

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Version" ADD CONSTRAINT "Version_qcReleaseId_fkey" FOREIGN KEY ("qcReleaseId") REFERENCES "QcRelease"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Version" ADD CONSTRAINT "Version_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Version" ADD CONSTRAINT "Version_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Phase" ADD CONSTRAINT "Phase_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Phase" ADD CONSTRAINT "Phase_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubPhase" ADD CONSTRAINT "SubPhase_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "Phase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedTeamId_fkey" FOREIGN KEY ("assignedTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_subPhaseId_fkey" FOREIGN KEY ("subPhaseId") REFERENCES "SubPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSubmission" ADD CONSTRAINT "TeamSubmission_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSubmission" ADD CONSTRAINT "TeamSubmission_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSubmission" ADD CONSTRAINT "TeamSubmission_submittedBy_fkey" FOREIGN KEY ("submittedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RehearsalSummary" ADD CONSTRAINT "RehearsalSummary_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionTemplate" ADD CONSTRAINT "VersionTemplate_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskProposal" ADD CONSTRAINT "TaskProposal_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrPlan" ADD CONSTRAINT "CrPlan_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrPlan" ADD CONSTRAINT "CrPlan_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrDependency" ADD CONSTRAINT "CrDependency_crPlanId_fkey" FOREIGN KEY ("crPlanId") REFERENCES "CrPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NightSummary" ADD CONSTRAINT "NightSummary_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionCrAssignment" ADD CONSTRAINT "VersionCrAssignment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionCrAssignment" ADD CONSTRAINT "VersionCrAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonDate" ADD CONSTRAINT "SeasonDate_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TesterProfile" ADD CONSTRAINT "TesterProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TesterSkill" ADD CONSTRAINT "TesterSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TesterProfile"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TesterSkill" ADD CONSTRAINT "TesterSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaAssignment" ADD CONSTRAINT "QaAssignment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaAssignment" ADD CONSTRAINT "QaAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaWorkPlan" ADD CONSTRAINT "QaWorkPlan_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaCycle" ADD CONSTRAINT "QaCycle_workPlanId_fkey" FOREIGN KEY ("workPlanId") REFERENCES "QaWorkPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaCycleTask" ADD CONSTRAINT "QaCycleTask_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "QaCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaCycleTask" ADD CONSTRAINT "QaCycleTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

