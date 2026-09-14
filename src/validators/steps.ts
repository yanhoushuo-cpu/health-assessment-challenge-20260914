import { z } from "zod";
export const stepNames = ["age", "gender", "goal", "body", "activity"] as const;
export type Step = (typeof stepNames)[number];
const version = z.number().int().nonnegative().max(2147483646);
export const completionSchema = z.strictObject({ version });
const quantity = (min: number, max: number) =>
  z
    .number()
    .finite()
    .min(min)
    .max(max)
    .refine(
      (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-7,
      "Use at most two decimal places",
    );
export const stepSchemas = {
  age: z.strictObject({ version, age: z.number().int().min(18).max(100) }),
  gender: z.strictObject({ version, gender: z.enum(["MALE", "FEMALE"]) }),
  goal: z.strictObject({
    version,
    goal: z.enum(["LOSE_WEIGHT", "MAINTAIN_WEIGHT", "GAIN_WEIGHT"]),
  }),
  body: z.strictObject({
    version,
    heightCm: quantity(120, 230),
    weightKg: quantity(35, 300),
    targetWeightKg: quantity(35, 300),
  }),
  activity: z.strictObject({
    version,
    activityLevel: z.enum([
      "SEDENTARY",
      "LIGHT",
      "MODERATE",
      "ACTIVE",
      "VERY_ACTIVE",
    ]),
  }),
};
export const paymentSchema = z.strictObject({ plan: z.literal("premium") });
export const keySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
