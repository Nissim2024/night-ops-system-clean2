-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN "groupId" TEXT;

-- CreateIndex
CREATE INDEX "LeaveRequest_groupId_idx" ON "LeaveRequest"("groupId");
