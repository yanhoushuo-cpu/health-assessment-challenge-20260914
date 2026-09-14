import type { PaymentEvent, PrismaClient } from "@prisma/client";
import { AppError } from "../errors/app-error";
import { lockUser, transactionOptions } from "../repositories/assessment";
import { isActive } from "../dto/result";
import { keySchema, paymentSchema } from "../validators/steps";
const paymentDto = (event: PaymentEvent) => ({
  paymentId: event.id,
  status: event.status,
  plan: event.plan,
  amount: event.amount,
  currency: event.currency,
  expiresAt: event.entitlementExpiresAt.toISOString(),
  simulated: true,
});
export async function pay(
  db: PrismaClient,
  userId: string,
  body: unknown,
  key: string | null,
) {
  if (process.env.DEMO_MODE !== "true")
    throw new AppError(
      "SIMULATION_DISABLED",
      "Payment simulation is disabled.",
      403,
    );
  const { plan } = paymentSchema.parse(body);
  const idempotencyKey = keySchema.parse(key);
  return db.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const existing = await tx.paymentEvent.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
    if (existing) {
      if (existing.plan !== plan)
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          "Key already used for a different payment.",
          409,
        );
      return paymentDto(existing);
    }
    const assessment = await tx.assessment.findUnique({ where: { userId } });
    if (assessment?.status !== "COMPLETED")
      throw new AppError(
        "ASSESSMENT_INCOMPLETE",
        "Complete your assessment before unlocking.",
        409,
      );
    const current = await tx.subscription.findUnique({ where: { userId } });
    const now = new Date();
    const expiresAt = isActive(current, now)
      ? current!.expiresAt!
      : new Date(now.getTime() + 30 * 86400000);
    const subscription = await tx.subscription.upsert({
      where: { userId },
      create: { userId, status: "ACTIVE", plan, startsAt: now, expiresAt },
      update: {
        status: "ACTIVE",
        plan,
        startsAt: isActive(current, now) ? current!.startsAt : now,
        expiresAt,
      },
    });
    return paymentDto(
      await tx.paymentEvent.create({
        data: {
          userId,
          subscriptionId: subscription.id,
          idempotencyKey,
          plan,
          entitlementExpiresAt: expiresAt,
        },
      }),
    );
  }, transactionOptions);
}
