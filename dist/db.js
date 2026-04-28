import "dotenv/config";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client.js";
const adapter = new PrismaBetterSQLite3({
    url: process.env.DATABASE_URL || "file:./dev.db",
});
export const prisma = new PrismaClient({ adapter });
