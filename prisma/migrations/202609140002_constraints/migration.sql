ALTER TABLE "Assessment"
  ADD CONSTRAINT "assessment_age_range" CHECK (age BETWEEN 18 AND 100),
  ADD CONSTRAINT "assessment_height_range" CHECK ("heightCm" BETWEEN 120 AND 230),
  ADD CONSTRAINT "assessment_weight_range" CHECK ("weightKg" BETWEEN 35 AND 300),
  ADD CONSTRAINT "assessment_target_range" CHECK ("targetWeightKg" BETWEEN 35 AND 300),
  ADD CONSTRAINT "assessment_version_nonnegative" CHECK (version >= 0),
  ADD CONSTRAINT "assessment_target_direction" CHECK (
    (goal = 'LOSE_WEIGHT' AND "targetWeightKg" < "weightKg") OR
    (goal = 'GAIN_WEIGHT' AND "targetWeightKg" > "weightKg") OR
    (goal = 'MAINTAIN_WEIGHT' AND "targetWeightKg" = "weightKg")
  ),
  ADD CONSTRAINT "assessment_completion_consistent" CHECK (
    (status = 'IN_PROGRESS' AND "completedAt" IS NULL) OR
    (status = 'COMPLETED' AND "completedAt" IS NOT NULL AND age IS NOT NULL AND gender IS NOT NULL AND goal IS NOT NULL AND "heightCm" IS NOT NULL AND "weightKg" IS NOT NULL AND "targetWeightKg" IS NOT NULL AND "activityLevel" IS NOT NULL)
  );
ALTER TABLE "AssessmentResult"
  ADD CONSTRAINT "result_positive_values" CHECK (bmi > 0 AND bmr > 0 AND tdee > 0 AND "recommendedCalories" > 0),
  ADD CONSTRAINT "result_category" CHECK ("bmiCategory" IN ('UNDERWEIGHT','NORMAL','OVERWEIGHT','OBESE'));
ALTER TABLE "Subscription" ADD CONSTRAINT "subscription_active_dates" CHECK (
  status <> 'ACTIVE' OR ("startsAt" IS NOT NULL AND "expiresAt" IS NOT NULL AND "expiresAt" > "startsAt")
);
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "payment_simulation_amount" CHECK (amount = 0);
