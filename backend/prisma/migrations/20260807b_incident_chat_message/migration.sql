-- CreateTable
CREATE TABLE "IncidentChatMessage" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "concluded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncidentChatMessage_incidentId_idx" ON "IncidentChatMessage"("incidentId");

-- AddForeignKey
ALTER TABLE "IncidentChatMessage" ADD CONSTRAINT "IncidentChatMessage_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

