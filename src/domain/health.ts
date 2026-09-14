import { z } from "zod";

const GENDERS = ["MALE", "FEMALE"] as const;
const GOALS = ["LOSE_WEIGHT", "MAINTAIN_WEIGHT", "GAIN_WEIGHT"] as const;
const ACTIVITY_LEVELS = [
  "SEDENTARY",
  "LIGHT",
  "MODERATE",
  "ACTIVE",
  "VERY_ACTIVE",
] as const;
const boundedMeasurement = (minimum: number, maximum: number) =>
  z.number().finite().min(minimum).max(maximum).multipleOf(0.01);

const baseHealthInputSchema = z.strictObject({
  age: z.number().int().min(18).max(100),
  gender: z.enum(GENDERS),
  goal: z.enum(GOALS),
  heightCm: boundedMeasurement(120, 230),
  weightKg: boundedMeasurement(35, 300),
  targetWeightKg: boundedMeasurement(35, 300),
  activityLevel: z.enum(ACTIVITY_LEVELS),
});

export const healthInputSchema = baseHealthInputSchema.superRefine(
  (input, context) => {
    const targetBmi = input.targetWeightKg / (input.heightCm / 100) ** 2;

    if (
      input.goal === "LOSE_WEIGHT" &&
      input.targetWeightKg >= input.weightKg
    ) {
      context.addIssue({
        code: "custom",
        path: ["targetWeightKg"],
        message: "A weight-loss target must be below current weight",
      });
    }
    if (
      input.goal === "GAIN_WEIGHT" &&
      input.targetWeightKg <= input.weightKg
    ) {
      context.addIssue({
        code: "custom",
        path: ["targetWeightKg"],
        message: "A weight-gain target must be above current weight",
      });
    }
    if (
      input.goal === "MAINTAIN_WEIGHT" &&
      input.targetWeightKg !== input.weightKg
    ) {
      context.addIssue({
        code: "custom",
        path: ["targetWeightKg"],
        message: "A maintenance target must equal current weight",
      });
    }
    if (
      input.goal !== "MAINTAIN_WEIGHT" &&
      (targetBmi < 18.5 || targetBmi > 30)
    ) {
      context.addIssue({
        code: "custom",
        path: ["targetWeightKg"],
        message: "Target BMI must be between 18.5 and 30",
      });
    }
  },
);

export type HealthInput = z.infer<typeof healthInputSchema>;

export type BmiCategory = "UNDERWEIGHT" | "NORMAL" | "OVERWEIGHT" | "OBESE";

export interface PredictionPoint {
  week: number;
  weightKg: number;
}

export interface HealthResult {
  bmi: number;
  bmiCategory: BmiCategory;
  bmr: number;
  tdee: number;
  recommendedCalories: number;
  predictedTargetDate: string | null;
  predictionCurve: PredictionPoint[];
  algorithmVersion: "1.0.0";
}

const activityFactors: Record<HealthInput["activityLevel"], number> = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
  MODERATE: 1.55,
  ACTIVE: 1.725,
  VERY_ACTIVE: 1.9,
};

const roundWeight = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export function bmiCategory(value: number): BmiCategory {
  if (value < 18.5) return "UNDERWEIGHT";
  if (value < 25) return "NORMAL";
  if (value < 30) return "OVERWEIGHT";
  return "OBESE";
}

export function calculateHealth(input: unknown, now: Date): HealthResult {
  const parsed = healthInputSchema.parse(input);
  const referenceDate = z.date().parse(now);
  const heightMeters = parsed.heightCm / 100;
  const rawBmi = parsed.weightKg / heightMeters ** 2;
  const sexConstant = parsed.gender === "MALE" ? 5 : -161;
  const rawBmr =
    10 * parsed.weightKg +
    6.25 * parsed.heightCm -
    5 * parsed.age +
    sexConstant;
  const rawTdee = rawBmr * activityFactors[parsed.activityLevel];
  const calorieAdjustment =
    parsed.goal === "LOSE_WEIGHT"
      ? -500
      : parsed.goal === "GAIN_WEIGHT"
        ? 300
        : 0;
  const calorieFloor = parsed.gender === "MALE" ? 1500 : 1200;

  let predictedTargetDate: string | null = null;
  const predictionCurve: PredictionPoint[] = [
    { week: 0, weightKg: parsed.weightKg },
  ];

  if (parsed.goal !== "MAINTAIN_WEIGHT") {
    const weeklyRate = parsed.goal === "LOSE_WEIGHT" ? 0.5 : 0.25;
    const direction = parsed.goal === "LOSE_WEIGHT" ? -1 : 1;
    const totalWeeks =
      Math.abs(parsed.targetWeightKg - parsed.weightKg) / weeklyRate;
    const curveWeeks = Math.min(1060, Math.ceil(totalWeeks));

    for (let week = 1; week <= curveWeeks; week += 1) {
      const projected = parsed.weightKg + direction * weeklyRate * week;
      const bounded =
        direction < 0
          ? Math.max(parsed.targetWeightKg, projected)
          : Math.min(parsed.targetWeightKg, projected);
      predictionCurve.push({ week, weightKg: roundWeight(bounded) });
    }

    const targetTime = z
      .number()
      .finite()
      .min(-8.64e15)
      .max(8.64e15)
      .parse(referenceDate.getTime() + Math.ceil(totalWeeks * 7) * 86_400_000);
    predictedTargetDate = new Date(targetTime).toISOString();
  }

  return {
    bmi: Math.round(rawBmi * 10) / 10,
    bmiCategory: bmiCategory(rawBmi),
    bmr: Math.round(rawBmr),
    tdee: Math.round(rawTdee),
    recommendedCalories: Math.max(
      calorieFloor,
      Math.round(rawTdee + calorieAdjustment),
    ),
    predictedTargetDate,
    predictionCurve,
    algorithmVersion: "1.0.0",
  };
}
