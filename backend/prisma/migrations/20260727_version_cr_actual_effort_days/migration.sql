-- Numeric value of the CR_LIST "Actuals" column (previously only parsed as a
-- V/X checkbox into hasActual) — needed for the version-management overview's
-- plan-vs-actual effort ratio.
ALTER TABLE "VersionCrAssignment" ADD COLUMN "actualEffortDays" DOUBLE PRECISION;
