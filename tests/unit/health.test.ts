import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  bmiCategory,
  calculateHealth,
  healthInputSchema,
} from "../../src/domain/health";

const validInput = {
  age: 30,
  gender: "MALE",
  goal: "LOSE_WEIGHT",
  heightCm: 180,
  weightKg: 80,
  targetWeightKg: 70,
  activityLevel: "MODERATE",
} as const;

describe("healthInputSchema", () => {
  it.each([
    ["age minimum", { age: 18 }],
    ["age maximum", { age: 100 }],
    [
      "height minimum",
      { heightCm: 120, goal: "MAINTAIN_WEIGHT", targetWeightKg: 80 },
    ],
    [
      "height maximum",
      { heightCm: 230, goal: "MAINTAIN_WEIGHT", targetWeightKg: 80 },
    ],
    [
      "weight minimum",
      { weightKg: 35, targetWeightKg: 35, goal: "MAINTAIN_WEIGHT" },
    ],
    [
      "weight maximum",
      { weightKg: 300, targetWeightKg: 300, goal: "MAINTAIN_WEIGHT" },
    ],
    [
      "target minimum",
      { weightKg: 35, targetWeightKg: 35, goal: "MAINTAIN_WEIGHT" },
    ],
    [
      "target maximum",
      { weightKg: 300, targetWeightKg: 300, goal: "MAINTAIN_WEIGHT" },
    ],
  ])("accepts the %s", (_name, change) => {
    expect(() =>
      healthInputSchema.parse({ ...validInput, ...change }),
    ).not.toThrow();
  });

  it.each([
    [
      "missing field",
      Object.fromEntries(
        Object.entries(validInput).filter(([key]) => key !== "age"),
      ),
    ],
    ["null", { ...validInput, age: null }],
    ["numeric string", { ...validInput, age: "30" }],
    ["NaN", { ...validInput, weightKg: Number.NaN }],
    ["Infinity", { ...validInput, heightCm: Number.POSITIVE_INFINITY }],
    [
      "height precision above two decimals",
      { ...validInput, heightCm: 180.001 },
    ],
    [
      "weight precision above two decimals",
      { ...validInput, weightKg: 80.001 },
    ],
    [
      "target precision above two decimals",
      { ...validInput, targetWeightKg: 70.001 },
    ],
    ["unknown field", { ...validInput, consent: true }],
    ["fractional age", { ...validInput, age: 30.5 }],
    ["age below minimum", { ...validInput, age: 17 }],
    ["age above maximum", { ...validInput, age: 101 }],
    ["height below minimum", { ...validInput, heightCm: 119.9 }],
    ["height above maximum", { ...validInput, heightCm: 230.1 }],
    ["weight below minimum", { ...validInput, weightKg: 34.9 }],
    ["weight above maximum", { ...validInput, weightKg: 300.1 }],
    ["target below minimum", { ...validInput, targetWeightKg: 34.9 }],
    ["target above maximum", { ...validInput, targetWeightKg: 300.1 }],
    ["invalid gender", { ...validInput, gender: "OTHER" }],
    ["invalid goal", { ...validInput, goal: "BUILD_MUSCLE" }],
    ["invalid activity", { ...validInput, activityLevel: "EXTREME" }],
    ["loss in wrong direction", { ...validInput, targetWeightKg: 80 }],
    ["loss above current weight", { ...validInput, targetWeightKg: 81 }],
    [
      "gain in wrong direction",
      { ...validInput, goal: "GAIN_WEIGHT", targetWeightKg: 79 },
    ],
    [
      "gain equal to current weight",
      { ...validInput, goal: "GAIN_WEIGHT", targetWeightKg: 80 },
    ],
    [
      "maintenance with different target",
      { ...validInput, goal: "MAINTAIN_WEIGHT", targetWeightKg: 79 },
    ],
    ["loss target BMI below 18.5", { ...validInput, targetWeightKg: 59.9 }],
    [
      "gain target BMI above 30",
      {
        ...validInput,
        goal: "GAIN_WEIGHT",
        weightKg: 80,
        targetWeightKg: 97.3,
      },
    ],
  ])("rejects %s with a ZodError", (_name, input) => {
    expect(() =>
      calculateHealth(input, new Date("2025-01-01T00:00:00.000Z")),
    ).toThrow(ZodError);
  });

  it("permits maintenance at an extreme current BMI", () => {
    const input = {
      ...validInput,
      goal: "MAINTAIN_WEIGHT",
      weightKg: 300,
      targetWeightKg: 300,
    };
    expect(healthInputSchema.parse(input)).toEqual(input);
  });
});

describe("bmiCategory", () => {
  it.each([
    [18.4999, "UNDERWEIGHT"],
    [18.5, "NORMAL"],
    [24.9999, "NORMAL"],
    [25, "OVERWEIGHT"],
    [29.9999, "OVERWEIGHT"],
    [30, "OBESE"],
  ] as const)("classifies unrounded BMI %s as %s", (value, expected) => {
    expect(bmiCategory(value)).toBe(expected);
  });
});

describe("calculateHealth", () => {
  it("returns literal Mifflin-St Jeor loss results and a UTC forecast", () => {
    const result = calculateHealth(
      validInput,
      new Date("2025-01-01T00:00:00.000Z"),
    );

    expect(result).toMatchObject({
      bmi: 24.7,
      bmiCategory: "NORMAL",
      bmr: 1780,
      tdee: 2759,
      recommendedCalories: 2259,
      predictedTargetDate: "2025-05-21T00:00:00.000Z",
      algorithmVersion: "1.0.0",
    });
    expect(result.predictionCurve).toHaveLength(21);
    expect(result.predictionCurve[0]).toEqual({ week: 0, weightKg: 80 });
    expect(result.predictionCurve[1]).toEqual({ week: 1, weightKg: 79.5 });
    expect(result.predictionCurve.at(-1)).toEqual({ week: 20, weightKg: 70 });
  });

  it("uses the female constant, light factor, and gain adjustment", () => {
    const result = calculateHealth(
      {
        ...validInput,
        gender: "FEMALE",
        goal: "GAIN_WEIGHT",
        heightCm: 165,
        weightKg: 60,
        targetWeightKg: 65,
        activityLevel: "LIGHT",
      },
      new Date("2025-01-01T13:45:00.000Z"),
    );
    expect(result).toMatchObject({
      bmi: 22,
      bmiCategory: "NORMAL",
      bmr: 1320,
      tdee: 1815,
      recommendedCalories: 2115,
    });
    expect(result.predictedTargetDate).toBe("2025-05-21T13:45:00.000Z");
    expect(result.predictionCurve.at(-1)).toEqual({ week: 20, weightKg: 65 });
  });

  it.each([
    ["SEDENTARY", 2136],
    ["LIGHT", 2448],
    ["MODERATE", 2759],
    ["ACTIVE", 3071],
    ["VERY_ACTIVE", 3382],
  ] as const)(
    "applies the %s activity factor",
    (activityLevel, expectedTdee) => {
      expect(
        calculateHealth(
          { ...validInput, activityLevel },
          new Date("2025-01-01Z"),
        ).tdee,
      ).toBe(expectedTdee);
    },
  );

  it.each([
    ["MALE", 120, 35, 1500],
    ["FEMALE", 120, 35, 1200],
  ] as const)(
    "applies the %s calorie floor",
    (gender, heightCm, weightKg, floor) => {
      const result = calculateHealth(
        {
          ...validInput,
          age: 100,
          gender,
          goal: "MAINTAIN_WEIGHT",
          heightCm,
          weightKg,
          targetWeightKg: weightKg,
          activityLevel: "SEDENTARY",
        },
        new Date("2025-01-01Z"),
      );
      expect(result.recommendedCalories).toBe(floor);
    },
  );

  it("uses the unrounded BMI for category classification", () => {
    const result = calculateHealth(
      {
        ...validInput,
        goal: "MAINTAIN_WEIGHT",
        heightCm: 200,
        weightKg: 99.99,
        targetWeightKg: 99.99,
      },
      new Date("2025-01-01Z"),
    );
    expect(result.bmi).toBe(25);
    expect(result.bmiCategory).toBe("NORMAL");
  });

  it("returns no date or curve progression for maintenance", () => {
    const result = calculateHealth(
      { ...validInput, goal: "MAINTAIN_WEIGHT", targetWeightKg: 80 },
      new Date("2025-01-01T00:00:00.000Z"),
    );
    expect(result.predictedTargetDate).toBeNull();
    expect(result.predictionCurve).toEqual([{ week: 0, weightKg: 80 }]);
  });

  it("rounds a partial final week to the exact endpoint and ceils forecast days", () => {
    const result = calculateHealth(
      { ...validInput, targetWeightKg: 78.8 },
      new Date("2025-01-01T00:00:00.000Z"),
    );
    expect(result.predictedTargetDate).toBe("2025-01-18T00:00:00.000Z");
    expect(result.predictionCurve).toEqual([
      { week: 0, weightKg: 80 },
      { week: 1, weightKg: 79.5 },
      { week: 2, weightKg: 79 },
      { week: 3, weightKg: 78.8 },
    ]);
  });

  it("bounds an extreme valid gain curve and preserves its endpoint", () => {
    const result = calculateHealth(
      {
        ...validInput,
        gender: "FEMALE",
        goal: "GAIN_WEIGHT",
        heightCm: 230,
        weightKg: 35,
        targetWeightKg: 158.69,
      },
      new Date("2025-01-01T00:00:00.000Z"),
    );
    expect(result.predictionCurve.length).toBeLessThanOrEqual(1061);
    expect(result.predictionCurve).toHaveLength(496);
    expect(result.predictionCurve.at(-1)).toEqual({
      week: 495,
      weightKg: 158.69,
    });
  });

  it("returns only finite numeric output at extreme valid values", () => {
    const result = calculateHealth(
      {
        ...validInput,
        age: 100,
        gender: "FEMALE",
        goal: "MAINTAIN_WEIGHT",
        heightCm: 120,
        weightKg: 300,
        targetWeightKg: 300,
        activityLevel: "VERY_ACTIVE",
      },
      new Date("2025-01-01Z"),
    );
    expect([
      result.bmi,
      result.bmr,
      result.tdee,
      result.recommendedCalories,
    ]).toSatisfy((values: number[]) => values.every(Number.isFinite));
  });

  it("rejects an invalid reference date with a controlled ZodError", () => {
    expect(() => calculateHealth(validInput, new Date(Number.NaN))).toThrow(
      ZodError,
    );
  });

  it("rejects a forecast date overflow with a controlled ZodError", () => {
    expect(() => calculateHealth(validInput, new Date(8.64e15))).toThrow(
      ZodError,
    );
  });
});
