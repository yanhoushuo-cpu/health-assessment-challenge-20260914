import { Prisma, type Assessment, type PrismaClient } from "@prisma/client";
import { AppError } from "../errors/app-error";
export const transactionOptions = { maxWait: 10000, timeout: 10000 };
export type Database = PrismaClient | Prisma.TransactionClient;
export const findAssessment = (db: Database, userId: string) =>
  db.assessment.findUnique({ where: { userId } });
export const compareAndSwap = (
  db: Database,
  row: Assessment,
  data: Prisma.AssessmentUpdateManyMutationInput,
) =>
  db.assessment.updateMany({
    where: { id: row.id, version: row.version, status: "IN_PROGRESS" },
    data: { ...data, version: { increment: 1 } },
  });
export async function updateAnswers(
  db: PrismaClient,
  row: Assessment,
  data: Prisma.AssessmentUpdateInput,
) {
  try {
    return await db.assessment.update({
      where: { id: row.id, version: row.version, status: "IN_PROGRESS" },
      data: { ...data, version: { increment: 1 } },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    )
      throw new AppError(
        "VERSION_CONFLICT",
        "Assessment was updated by another request.",
        409,
      );
    throw error;
  }
}
export async function lockUser(db: Prisma.TransactionClient, userId: string) {
  // Parameter binding is maintained by Prisma's tagged template.
  await db.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
}
