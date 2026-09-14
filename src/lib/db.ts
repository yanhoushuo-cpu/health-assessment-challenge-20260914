import { PrismaClient } from "@prisma/client";
const globalDb = globalThis as unknown as { healthDb?: PrismaClient };
export const db = globalDb.healthDb ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalDb.healthDb = db;
