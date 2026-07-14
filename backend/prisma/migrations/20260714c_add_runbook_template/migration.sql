-- CreateTable
CREATE TABLE "RunbookTemplate" (
    "id" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "envLabel" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "nextStepKey" INTEGER NOT NULL DEFAULT 100,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunbookTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RunbookTemplate_templateKey_key" ON "RunbookTemplate"("templateKey");
