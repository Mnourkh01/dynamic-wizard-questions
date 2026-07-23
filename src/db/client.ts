import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Single Prisma instance, reused across hot reloads in dev so we do not exhaust
// connections. Single source of truth for DB access.
//
// Prisma 7's client is driver-adapter based: SQLite access goes through the
// better-sqlite3 adapter. The DATABASE_URL ("file:./dev.db") resolves relative
// to the process cwd (project root), matching where migrations write.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({ adapter });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
