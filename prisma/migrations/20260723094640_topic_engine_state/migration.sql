/*
  Warnings:

  - Added the required column `firstPickPrior` to the `Topic` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Topic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,
    "theta" REAL NOT NULL,
    "sigma" REAL NOT NULL,
    "firstPickPrior" REAL NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "questionsAsked" INTEGER NOT NULL DEFAULT 0,
    "answeredCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveStrong" INTEGER NOT NULL DEFAULT 0,
    "converged" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Topic_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Topic" ("converged", "id", "name", "order", "points", "questionsAsked", "sessionId", "sigma", "theta", "weight") SELECT "converged", "id", "name", "order", "points", "questionsAsked", "sessionId", "sigma", "theta", "weight" FROM "Topic";
DROP TABLE "Topic";
ALTER TABLE "new_Topic" RENAME TO "Topic";
CREATE INDEX "Topic_sessionId_idx" ON "Topic"("sessionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
