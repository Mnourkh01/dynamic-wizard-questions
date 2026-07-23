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
    "blueprintPending" BOOLEAN NOT NULL DEFAULT false,
    "finalScore" INTEGER,
    "reportJson" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME
);
INSERT INTO "new_Session" ("candidateName", "finalScore", "finishedAt", "id", "language", "persona", "reportJson", "role", "specialization", "startedAt", "status") SELECT "candidateName", "finalScore", "finishedAt", "id", "language", "persona", "reportJson", "role", "specialization", "startedAt", "status" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
