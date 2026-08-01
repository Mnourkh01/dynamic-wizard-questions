-- AlterTable
ALTER TABLE "Evaluation" ADD COLUMN "axisProfileJson" TEXT;
ALTER TABLE "Evaluation" ADD COLUMN "band" INTEGER;
ALTER TABLE "Evaluation" ADD COLUMN "observationsJson" TEXT;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN "affordsJson" TEXT;
ALTER TABLE "Question" ADD COLUMN "intent" TEXT;
ALTER TABLE "Question" ADD COLUMN "targetLevel" REAL;

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN "tag" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "specialization" TEXT,
    "candidateName" TEXT,
    "persona" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'active',
    "mode" TEXT NOT NULL DEFAULT 'mcq',
    "maxQuestions" INTEGER NOT NULL DEFAULT 25,
    "blueprintPending" BOOLEAN NOT NULL DEFAULT false,
    "finalScore" INTEGER,
    "reportJson" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);
INSERT INTO "new_Session" ("blueprintPending", "candidateName", "finalScore", "finishedAt", "id", "language", "persona", "reportJson", "role", "specialization", "startedAt", "status") SELECT "blueprintPending", "candidateName", "finalScore", "finishedAt", "id", "language", "persona", "reportJson", "role", "specialization", "startedAt", "status" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Question_sessionId_order_key" ON "Question"("sessionId", "order");

