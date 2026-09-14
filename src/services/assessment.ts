import type { Assessment, PrismaClient } from "@prisma/client";
import { calculateHealth, healthInputSchema } from "../domain/health";
import { AppError } from "../errors/app-error";
import {
  compareAndSwap,
  findAssessment,
  lockUser,
  transactionOptions,
  updateAnswers,
} from "../repositories/assessment";
import { resultDto } from "../dto/result";
import { stepNames, stepSchemas, type Step } from "../validators/steps";
export function answers(row: Assessment) {
  return {
    age: row.age,
    gender: row.gender,
    goal: row.goal,
    heightCm: row.heightCm === null ? null : Number(row.heightCm),
    weightKg: row.weightKg === null ? null : Number(row.weightKg),
    targetWeightKg:
      row.targetWeightKg === null ? null : Number(row.targetWeightKg),
    activityLevel: row.activityLevel,
  };
}
export function assessmentDto(row: Assessment) {
  const data = answers(row);
  const complete = [
    data.age !== null,
    data.gender !== null,
    data.goal !== null,
    data.heightCm !== null &&
      data.weightKg !== null &&
      data.targetWeightKg !== null,
    data.activityLevel !== null,
  ];
  const completedSteps = stepNames.filter((_, i) => complete[i]);
  return {
    id: row.id,
    currentStep: stepNames[complete.indexOf(false)] ?? "complete",
    completedSteps,
    progress: completedSteps.length * 20,
    data,
    version: row.version,
    status: row.status,
  };
}
export async function currentAssessment(db: PrismaClient, userId: string) {
  const row = await findAssessment(db, userId);
  if (!row)
    throw new AppError("ASSESSMENT_NOT_FOUND", "Assessment not found.", 404);
  return row;
}
export async function saveStep(
  db: PrismaClient,
  userId: string,
  step: Step,
  body: unknown,
) {
  const input = stepSchemas[step].parse(body);
  const row = await currentAssessment(db, userId);
  if (row.status === "COMPLETED")
    throw new AppError(
      "ASSESSMENT_ALREADY_COMPLETED",
      "Completed assessments are immutable.",
      409,
    );
  if (row.version !== input.version)
    throw new AppError(
      "VERSION_CONFLICT",
      "Assessment was updated by another request. Refresh to resume.",
      409,
    );
  const progress = assessmentDto(row);
  if (stepNames.indexOf(step) > progress.completedSteps.length)
    throw new AppError(
      "STEP_OUT_OF_ORDER",
      "Please finish the previous question first.",
      409,
    );
  const { version: _version, ...data } = input;
  void _version;
  const merged = { ...answers(row), ...data };
  // Editing the goal invalidates the old target, so the body step is answered again.
  const patch =
    step === "goal" && row.goal !== null && row.goal !== merged.goal
      ? {
          ...data,
          heightCm: null,
          weightKg: null,
          targetWeightKg: null,
          activityLevel: null,
        }
      : data;
  if (step === "body")
    healthInputSchema.parse({
      ...merged,
      activityLevel: merged.activityLevel ?? "SEDENTARY",
    });
  return assessmentDto(await updateAnswers(db, row, patch));
}
export async function getResult(db: PrismaClient, userId: string) {
  const row = await db.assessment.findUnique({
    where: { userId },
    include: { result: true, user: { include: { subscription: true } } },
  });
  if (!row?.result)
    throw new AppError(
      "RESULT_NOT_FOUND",
      "Finish your assessment to view your result.",
      404,
    );
  return resultDto(row.result, row.user.subscription);
}
export async function completeAssessment(
  db: PrismaClient,
  userId: string,
  expectedVersion: number,
) {
  await db.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const row = await tx.assessment.findUniqueOrThrow({ where: { userId } });
    if (row.status === "COMPLETED") return;
    if (assessmentDto(row).progress !== 100)
      throw new AppError(
        "ASSESSMENT_INCOMPLETE",
        "Complete every question first.",
        409,
      );
    if (row.version !== expectedVersion)
      throw new AppError(
        "VERSION_CONFLICT",
        "Your answers changed. Review the latest version before completing.",
        409,
      );
    const now = new Date();
    const result = calculateHealth(answers(row), now);
    const updated = await compareAndSwap(tx, row, {
      status: "COMPLETED",
      completedAt: now,
    });
    if (updated.count !== 1)
      throw new AppError(
        "VERSION_CONFLICT",
        "Assessment changed during calculation. Please try again.",
        409,
      );
    await tx.assessmentResult.create({
      data: {
        ...result,
        predictionCurve: result.predictionCurve.map((point) => ({ ...point })),
        assessmentId: row.id,
      },
    });
  }, transactionOptions);
  return getResult(db, userId);
}
