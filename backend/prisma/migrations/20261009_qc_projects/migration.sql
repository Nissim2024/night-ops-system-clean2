-- CreateTable
CREATE TABLE "QcProject" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "restProject" TEXT NOT NULL,
    "oracleSchema" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "writeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QcProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QcProjectAccess" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QcProjectAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QcProject_key_key" ON "QcProject"("key");

-- CreateIndex
CREATE INDEX "QcProjectAccess_projectId_idx" ON "QcProjectAccess"("projectId");

-- AddForeignKey
ALTER TABLE "QcProjectAccess" ADD CONSTRAINT "QcProjectAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "QcProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

