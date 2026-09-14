# Health assessment engineering design

Architecture: Next.js App Router + TypeScript, Prisma + PostgreSQL, Zod, Vitest and Playwright. Deployment target is Vercel + Supabase, as explicitly requested; Sites runtime is not used because its database/runtime would change the required stack.

Anonymous identity uses a 32-byte opaque bearer credential in an HttpOnly SameSite=Lax cookie. Only SHA-256 hashes are stored. Session IDs are identifiers, never authorization. Mutating browser requests require same-origin and JSON; programmatic curl clients may omit Origin. Responses are no-store. Credentials expire after 30 days.

Typed entities: User, Session, Assessment, AssessmentResult, Subscription, PaymentEvent. Body values use Decimal, age and version use integers, categorical values use enums. User has one current assessment and one subscription; result is unique per assessment. SQL constraints supplement Zod. Delete policy cascades anonymous aggregate data.

Steps: age, gender, goal, body, activity. Out-of-order future steps return 409; revisiting completed steps is allowed before completion. Progress derives from persisted completeness, never client input. All writes compare version atomically; stale retries return 409 and client recovers persisted state. Completion freezes answers and atomically stores one result. Repeated completion returns the authorized projection.

Payment simulation requires authenticated session, completed assessment, and Idempotency-Key. A per-user transaction lock serializes grants. Key uniqueness is scoped to user. Retrying the same key returns the original event without extending expiry; new payments while active do not stack entitlements. Payment and subscription commit together. /pay is an alias of /api/v1/pay. No real money or provider callbacks are claimed.

Free DTO allowlist: bmi, bmiCategory, subscriptionRequired. Paid DTO adds bmr, tdee, recommendedCalories, predictedTargetDate, predictionCurve, algorithmVersion. Entitlement checks status AND expiry on every result read; no cache.

Algorithm: validated adult-only demonstration, Mifflin-St Jeor, activity factors, calories floor, goal direction checks and target BMI guard. Prediction is a stated illustrative rate, not a medical promise. BMI category uses unrounded value. Stable UTC dates; bounded curve length; maintenance has null forecast.

Verification: independent literal unit expectations; real PostgreSQL HTTP integration tests including races, duplicates, ownership, expiration, malformed JSON and field leakage; browser E2E with interrupted progress and simulated payment; CI PostgreSQL service plus lint/typecheck/build. Separate TEST_DATABASE_URL with isolated per-run schema and no production reset.

Delivery: repository, migrations, seed/demo sessions, API examples, ER diagram, truthful AI decision log and validation evidence. No invented CI/deployment statuses or fabricated human rejection story. Public deployment and demo credentials contain synthetic data only.
