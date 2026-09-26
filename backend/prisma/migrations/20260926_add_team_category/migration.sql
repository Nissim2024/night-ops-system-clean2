-- CreateEnum
CREATE TYPE "TeamCategory" AS ENUM ('DEV', 'QA', 'OPS');

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "category" "TeamCategory";
