-- AlterTable
ALTER TABLE "QaCycle" ADD COLUMN     "qgEnvironment" TEXT,
ADD COLUMN     "qgThresholdHigh" INTEGER,
ADD COLUMN     "qgThresholdLow" INTEGER,
ADD COLUMN     "qgThresholdMedium" INTEGER;
