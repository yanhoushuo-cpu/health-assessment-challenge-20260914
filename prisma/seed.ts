import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { startSession } from "../src/auth/session";
import { completeAssessment, saveStep } from "../src/services/assessment";
import { pay } from "../src/services/payment";
import type { Step } from "../src/validators/steps";
if (process.env.DEMO_MODE !== "true")
  throw new Error("Set DEMO_MODE=true to seed synthetic reviewer accounts.");
const db = new PrismaClient();
const demos = [];
try {
  for (const paid of [false, true]) {
    const started = await startSession(
      db,
      new Request("http://localhost/api/v1/session", { method: "POST" }),
    );
    const steps: [Step, Record<string, string | number>][] = [
      ["age", { age: 30 }],
      ["gender", { gender: "MALE" }],
      ["goal", { goal: "LOSE_WEIGHT" }],
      ["body", { heightCm: 180, weightKg: 85, targetWeightKg: 75 }],
      ["activity", { activityLevel: "MODERATE" }],
    ];
    for (let version = 0; version < steps.length; version++)
      await saveStep(db, started.session.userId, steps[version][0], {
        ...steps[version][1],
        version,
      });
    await completeAssessment(db, started.session.userId, 5);
    if (paid)
      await pay(
        db,
        started.session.userId,
        { plan: "premium" },
        "seed-" + started.session.id,
      );
    demos.push({
      label: paid ? "paid" : "unpaid",
      sessionId: started.session.id,
      cookie: started.cookie!.split(";")[0],
      expiresAt: started.session.expiresAt.toISOString(),
    });
  }
  await writeFile("demo-sessions.json", JSON.stringify(demos, null, 2));
  process.stdout.write(
    "Created two synthetic sessions. Credentials saved to ignored demo-sessions.json.\n",
  );
} finally {
  await db.$disconnect();
}
