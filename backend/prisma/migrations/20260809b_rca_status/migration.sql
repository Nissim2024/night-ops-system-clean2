-- CreateEnum
CREATE TYPE "RcaStatus" AS ENUM ('OPEN', 'INVESTIGATION', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Rca" ADD COLUMN     "status" "RcaStatus" NOT NULL DEFAULT 'OPEN';

