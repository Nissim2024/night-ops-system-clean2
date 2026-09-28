-- CreateTable
-- Cached copy of QC's real Project-Lists picklist values (2026-09-23,
-- fixes-batch A.6) — see the QcPicklistCache model comment in schema.prisma
-- for why this is a cache refreshed by an admin action, not a live QC call
-- per form render.
CREATE TABLE "QcPicklistCache" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "listName" TEXT NOT NULL,
    "values" TEXT[],
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QcPicklistCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QcPicklistCache_listId_key" ON "QcPicklistCache"("listId");
