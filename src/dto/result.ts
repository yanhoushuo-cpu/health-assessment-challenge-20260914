import type { AssessmentResult, Subscription } from "@prisma/client";
export function isActive(subscription: Subscription | null, now = new Date()) {
  return (
    !!subscription &&
    subscription.status === "ACTIVE" &&
    !!subscription.startsAt &&
    subscription.startsAt <= now &&
    !!subscription.expiresAt &&
    subscription.expiresAt > now
  );
}
export function resultDto(
  result: AssessmentResult,
  subscription: Subscription | null,
) {
  const basic = {
    bmi: Number(result.bmi),
    bmiCategory: result.bmiCategory,
    subscriptionRequired: !isActive(subscription),
  };
  if (basic.subscriptionRequired) return basic;
  return {
    ...basic,
    bmr: result.bmr,
    tdee: result.tdee,
    recommendedCalories: result.recommendedCalories,
    predictedTargetDate: result.predictedTargetDate?.toISOString() ?? null,
    predictionCurve: result.predictionCurve,
    algorithmVersion: result.algorithmVersion,
  };
}
