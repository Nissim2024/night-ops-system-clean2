-- CreateEnum
CREATE TYPE "ActionItemKind" AS ENUM ('CORRECTIVE', 'PREVENTIVE');

-- AlterEnum
ALTER TYPE "RcaMethod" ADD VALUE 'GUIDED';

-- AlterTable
ALTER TABLE "ActionItem" ADD COLUMN     "kind" "ActionItemKind";

-- AlterTable
ALTER TABLE "Rca" ADD COLUMN     "directCause" TEXT,
ADD COLUMN     "factsActionTaken" TEXT,
ADD COLUMN     "factsActualResult" TEXT,
ADD COLUMN     "factsExpectedResult" TEXT,
ADD COLUMN     "factsLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "factsReproducibility" TEXT,
ADD COLUMN     "factsTiming" TEXT,
ADD COLUMN     "treeLeafId" TEXT,
ADD COLUMN     "treePath" JSONB;

