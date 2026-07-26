-- Track expected/actual QA-arrival date per CR, so the home-page can flag a
-- CR whose arrival date has passed without being marked received.
ALTER TABLE "VersionCrAssignment"
  ADD COLUMN "qaArrivalDate" TIMESTAMP(3),
  ADD COLUMN "qaReceived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "qaReceivedAt" TIMESTAMP(3);
