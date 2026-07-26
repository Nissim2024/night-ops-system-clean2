-- Add CANCELLED status and audit trail (who/when/optional reason) for
-- approval and cancellation of leave requests — previously only
-- createdAt/updatedAt existed, with no record of which manager decided
-- a request or who cancelled it.
ALTER TYPE "LeaveStatus" ADD VALUE 'CANCELLED';

ALTER TABLE "LeaveRequest"
  ADD COLUMN "decidedByName" TEXT,
  ADD COLUMN "decidedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledByName" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelReason" TEXT;
