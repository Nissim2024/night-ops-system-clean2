-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "affectedUsersCount" INTEGER,
ADD COLUMN     "businessProcess" TEXT,
ADD COLUMN     "crReferenceNumber" TEXT,
ADD COLUMN     "customerFacing" BOOLEAN,
ADD COLUMN     "downtimeMinutes" INTEGER,
ADD COLUMN     "impact" TEXT,
ADD COLUMN     "mainBusinessProcess" TEXT,
ADD COLUMN     "mainModule" TEXT,
ADD COLUMN     "subModule" TEXT,
ADD COLUMN     "systemComponent" TEXT;

