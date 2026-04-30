import "dotenv/config";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL || "file:./dev.db",
});
