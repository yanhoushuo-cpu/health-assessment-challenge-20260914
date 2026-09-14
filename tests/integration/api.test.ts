import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createServer, type Server } from "node:http";
import { handleApi } from "../../src/http/api";

const testDatabase = new URL(
  process.env.DATABASE_URL ?? "postgresql://invalid/invalid",
);
if (
  !testDatabase.pathname.endsWith("_test") ||
  !/^test_[a-f0-9]{32}$/.test(testDatabase.searchParams.get("schema") ?? "")
) {
  throw new Error(
    "Integration tests require the isolated schema created by npm test. Refusing database access.",
  );
}
const db = new PrismaClient();
let server: Server;
let base: string;
type Reply = {
  status: number;
  body: {
    data: {
      sessionId: string;
      userId: string;
      paymentId: string;
      expiresAt: string;
      subscriptionRequired: boolean;
      currentStep: string;
      version: number;
      progress: number;
      data: { age: number };
    };
    error: { code: string };
  };
  cookie: string | null;
};
async function api(
  path: string,
  method = "GET",
  data?: unknown,
  cookie = "",
  extra: Record<string, string> = {},
): Promise<Reply> {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...extra,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return {
    status: r.status,
    body: await r.json(),
    cookie: r.headers.get("set-cookie"),
  };
}
async function session() {
  const r = await api("/api/v1/session", "POST", {});
  expect(r.status).toBe(201);
  return {
    cookie: r.cookie!.split(";")[0],
    id: r.body.data.sessionId,
    userId: r.body.data.userId,
  };
}
const steps = [
  ["age", { age: 30 }],
  ["gender", { gender: "MALE" }],
  ["goal", { goal: "LOSE_WEIGHT" }],
  ["body", { heightCm: 180, weightKg: 85, targetWeightKg: 75 }],
  ["activity", { activityLevel: "MODERATE" }],
] as const;
async function complete(cookie: string) {
  for (let i = 0; i < steps.length; i++) {
    const [step, data] = steps[i];
    expect(
      (
        await api(
          "/api/v1/assessment/current/steps/" + step,
          "PATCH",
          { ...data, version: i },
          cookie,
        )
      ).status,
    ).toBe(200);
  }
  return api(
    "/api/v1/assessment/current/complete",
    "POST",
    { version: 5 },
    cookie,
  );
}
const protectedFields = [
  "bmr",
  "tdee",
  "recommendedCalories",
  "predictedTargetDate",
  "predictionCurve",
  "algorithmVersion",
];
beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const request = new Request(base + req.url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: ["GET", "HEAD"].includes(req.method!)
        ? undefined
        : Buffer.concat(chunks),
    });
    const response = await handleApi(request, db);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + (server.address() as { port: number }).port;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.$disconnect();
});
describe("real PostgreSQL HTTP lifecycle", () => {
  it("database RLS prevents non-owner Data API roles from reading application tables", async () => {
    const s = await session();
    expect(await db.session.count({ where: { id: s.id } })).toBe(1);
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE pg_read_all_data");
      for (const table of [
        "User",
        "Session",
        "Assessment",
        "AssessmentResult",
        "Subscription",
        "PaymentEvent",
      ]) {
        const rows = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT count(*) FROM "${table}"`,
        );
        expect(rows[0].count).toBe(0n);
      }
    });
  });
  it("handles payment contention longer than default Prisma acquisition timeout", async () => {
    const s = await session();
    await complete(s.cookie);
    let signalReady = () => {};
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve;
    });
    const blocker = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${s.userId}::uuid FOR UPDATE`;
        signalReady();
        await tx.$queryRaw`SELECT 1 FROM pg_sleep(3)`;
      },
      { timeout: 10000 },
    );
    await ready;
    const payments = await Promise.all(
      Array.from({ length: 4 }, () =>
        api("/pay", "POST", { plan: "premium" }, s.cookie, {
          "Idempotency-Key": "contended-payment",
        }),
      ),
    );
    await blocker;
    expect(payments.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(new Set(payments.map((r) => r.body.data.paymentId)).size).toBe(1);
  });
  it("rejects stale completion without freezing newer answers", async () => {
    const s = await session();
    for (let version = 0; version < steps.length; version++)
      await api(
        "/api/v1/assessment/current/steps/" + steps[version][0],
        "PATCH",
        { ...steps[version][1], version },
        s.cookie,
      );
    await api(
      "/api/v1/assessment/current/steps/age",
      "PATCH",
      { age: 31, version: 5 },
      s.cookie,
    );
    const stale = await api(
      "/api/v1/assessment/current/complete",
      "POST",
      { version: 5 },
      s.cookie,
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    expect(
      await db.assessmentResult.count({
        where: { assessment: { userId: s.userId } },
      }),
    ).toBe(0);
    expect(
      (
        await api(
          "/api/v1/assessment/current/complete",
          "POST",
          { version: 6 },
          s.cookie,
        )
      ).status,
    ).toBe(200);
  });
  it("creates hashed, HttpOnly identity and resumes same session", async () => {
    const s = await session();
    const again = await api("/api/v1/session", "POST", {}, s.cookie);
    expect(again.body.data.sessionId).toBe(s.id);
    const row = await db.session.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.tokenHash).toHaveLength(64);
    expect(row.tokenHash).not.toContain(s.cookie.split("=")[1]);
    expect((await api("/api/v1/session", "POST", {})).cookie).toContain(
      "HttpOnly",
    );
  });
  it("denies missing, forged and expired credentials", async () => {
    expect((await api("/api/v1/result")).status).toBe(401);
    expect(
      (await api("/api/v1/result", "GET", undefined, "health_session=forged"))
        .status,
    ).toBe(401);
    const s = await session();
    await db.session.update({
      where: { id: s.id },
      data: { expiresAt: new Date(0) },
    });
    const r = await api("/api/v1/result", "GET", undefined, s.cookie);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("SESSION_EXPIRED");
  });
  it("persists step and restores progress after interruption", async () => {
    const s = await session();
    await api(
      "/api/v1/assessment/current/steps/age",
      "PATCH",
      { age: 35, version: 0 },
      s.cookie,
    );
    const r = await api(
      "/api/v1/assessment/current",
      "GET",
      undefined,
      s.cookie,
    );
    expect(r.body.data.data.age).toBe(35);
    expect(r.body.data.currentStep).toBe("gender");
    expect(r.body.data.version).toBe(1);
    expect(r.body.data.progress).toBe(20);
  });
  it("rejects skipping steps and unknown step names", async () => {
    const s = await session();
    expect(
      (
        await api(
          "/api/v1/assessment/current/steps/goal",
          "PATCH",
          { goal: "LOSE_WEIGHT", version: 0 },
          s.cookie,
        )
      ).body.error.code,
    ).toBe("STEP_OUT_OF_ORDER");
    expect(
      (
        await api(
          "/api/v1/assessment/current/steps/nope",
          "PATCH",
          { version: 0 },
          s.cookie,
        )
      ).status,
    ).toBe(404);
  });
  it("stale duplicate writes conflict and revision allows editing", async () => {
    const s = await session();
    const path = "/api/v1/assessment/current/steps/age";
    expect(
      (await api(path, "PATCH", { age: 30, version: 0 }, s.cookie)).status,
    ).toBe(200);
    expect(
      (await api(path, "PATCH", { age: 30, version: 0 }, s.cookie)).body.error
        .code,
    ).toBe("VERSION_CONFLICT");
    expect(
      (await api(path, "PATCH", { age: 31, version: 1 }, s.cookie)).body.data
        .data.age,
    ).toBe(31);
  });
  it("atomic CAS permits exactly one concurrent writer", async () => {
    const s = await session();
    const writes = await Promise.all(
      [30, 40].map((age) =>
        api(
          "/api/v1/assessment/current/steps/age",
          "PATCH",
          { age, version: 0 },
          s.cookie,
        ),
      ),
    );
    expect(writes.map((r) => r.status).sort()).toEqual([200, 409]);
    const r = await api(
      "/api/v1/assessment/current",
      "GET",
      undefined,
      s.cookie,
    );
    expect(r.body.data.version).toBe(1);
    expect(r.body.data.data.age).toBe(
      writes.find((r) => r.status === 200)!.body.data.data.age,
    );
  });
  it.each([null, 0, -1, 17, 101, 18.5, "30", "1 OR 1=1", 1e100])(
    "rejects age %s without persistence",
    async (age) => {
      const s = await session();
      expect(
        (
          await api(
            "/api/v1/assessment/current/steps/age",
            "PATCH",
            { age, version: 0 },
            s.cookie,
          )
        ).status,
      ).toBe(422);
      expect(
        (await api("/api/v1/assessment/current", "GET", undefined, s.cookie))
          .body.data.version,
      ).toBe(0);
    },
  );
  it("rejects unknown fields and invalid enum", async () => {
    const s = await session();
    expect(
      (
        await api(
          "/api/v1/assessment/current/steps/age",
          "PATCH",
          { age: 30, version: 0, subscription_status: "ACTIVE" },
          s.cookie,
        )
      ).status,
    ).toBe(422);
    await api(
      "/api/v1/assessment/current/steps/age",
      "PATCH",
      { age: 30, version: 0 },
      s.cookie,
    );
    expect(
      (
        await api(
          "/api/v1/assessment/current/steps/gender",
          "PATCH",
          { gender: "ADMIN", version: 1 },
          s.cookie,
        )
      ).status,
    ).toBe(422);
  });
  it("rejects malformed JSON, cross origin and oversized body", async () => {
    const s = await session();
    const bad = await fetch(base + "/api/v1/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: s.cookie },
      body: "{",
    });
    expect(bad.status).toBe(400);
    expect(
      (
        await api("/api/v1/pay", "POST", {}, s.cookie, {
          Origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
    expect(
      (await api("/api/v1/pay", "POST", { blob: "x".repeat(17000) }, s.cookie))
        .status,
    ).toBe(413);
  });
  it("refuses incomplete completion and pre-assessment payment", async () => {
    const s = await session();
    expect(
      (
        await api(
          "/api/v1/assessment/current/complete",
          "POST",
          { version: 5 },
          s.cookie,
        )
      ).body.error.code,
    ).toBe("ASSESSMENT_INCOMPLETE");
    expect(
      (
        await api("/pay", "POST", { plan: "premium" }, s.cookie, {
          "Idempotency-Key": "before-complete",
        })
      ).status,
    ).toBe(409);
    expect(await db.paymentEvent.count({ where: { userId: s.userId } })).toBe(
      0,
    );
  });
  it("completes once, freezes answers, never leaks premium fields through completion", async () => {
    const s = await session();
    const r = await complete(s.cookie);
    expect(r.status).toBe(200);
    for (const key of protectedFields)
      expect(r.body.data).not.toHaveProperty(key);
    const again = await api(
      "/api/v1/assessment/current/complete",
      "POST",
      { version: 5 },
      s.cookie,
    );
    expect(again.body).toEqual(r.body);
    expect(
      await db.assessmentResult.count({
        where: { assessment: { userId: s.userId } },
      }),
    ).toBe(1);
    expect(
      (
        await api(
          "/api/v1/assessment/current/steps/age",
          "PATCH",
          { age: 40, version: 6 },
          s.cookie,
        )
      ).body.error.code,
    ).toBe("ASSESSMENT_ALREADY_COMPLETED");
  });
  it("free -> simulated pay -> full result; repeated payment is idempotent", async () => {
    const s = await session();
    await complete(s.cookie);
    const free = await api("/api/v1/result", "GET", undefined, s.cookie);
    expect(free.body.data.subscriptionRequired).toBe(true);
    for (const key of protectedFields)
      expect(free.body.data).not.toHaveProperty(key);
    const headers = { "Idempotency-Key": "full-flow-key" };
    const payment = await api(
      "/pay",
      "POST",
      { plan: "premium" },
      s.cookie,
      headers,
    );
    expect(payment.status).toBe(200);
    const replay = await api(
      "/api/v1/pay",
      "POST",
      { plan: "premium" },
      s.cookie,
      headers,
    );
    expect(replay.body).toEqual(payment.body);
    expect(await db.paymentEvent.count({ where: { userId: s.userId } })).toBe(
      1,
    );
    expect(
      await db.subscription.count({
        where: { userId: s.userId, status: "ACTIVE" },
      }),
    ).toBe(1);
    const full = await api("/api/v1/result", "GET", undefined, s.cookie);
    for (const key of protectedFields)
      expect(full.body.data).toHaveProperty(key);
    expect(full.body.data.subscriptionRequired).toBe(false);
  });
  it("serializes concurrent same-key payments", async () => {
    const s = await session();
    await complete(s.cookie);
    const replies = await Promise.all(
      Array.from({ length: 4 }, () =>
        api("/pay", "POST", { plan: "premium" }, s.cookie, {
          "Idempotency-Key": "race-payment",
        }),
      ),
    );
    expect(replies.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(new Set(replies.map((r) => r.body.data.paymentId)).size).toBe(1);
    expect(await db.paymentEvent.count({ where: { userId: s.userId } })).toBe(
      1,
    );
  });
  it("does not stack active entitlements and revoked/expired users lose access", async () => {
    const s = await session();
    await complete(s.cookie);
    const first = await api("/pay", "POST", { plan: "premium" }, s.cookie, {
      "Idempotency-Key": "payment-1",
    });
    const second = await api("/pay", "POST", { plan: "premium" }, s.cookie, {
      "Idempotency-Key": "payment-2",
    });
    expect(first.body.data.expiresAt).toBe(second.body.data.expiresAt);
    await db.subscription.update({
      where: { userId: s.userId },
      data: { startsAt: new Date(-86400000), expiresAt: new Date(0) },
    });
    const expired = await api("/api/v1/result", "GET", undefined, s.cookie);
    for (const key of protectedFields)
      expect(expired.body.data).not.toHaveProperty(key);
  });
  it("isolates users and never authorizes by public sessionId", async () => {
    const a = await session(),
      b = await session();
    await complete(a.cookie);
    await api("/pay", "POST", { plan: "premium" }, a.cookie, {
      "Idempotency-Key": "same-key",
    });
    expect(
      (await api("/api/v1/result", "GET", undefined, b.cookie)).status,
    ).toBe(404);
    expect(
      (await api("/api/v1/result", "GET", undefined, "health_session=" + a.id))
        .status,
    ).toBe(401);
    await complete(b.cookie);
    expect(
      (await api("/api/v1/result", "GET", undefined, b.cookie)).body.data
        .subscriptionRequired,
    ).toBe(true);
    expect(
      (
        await api("/pay", "POST", { plan: "premium" }, b.cookie, {
          "Idempotency-Key": "same-key",
        })
      ).status,
    ).toBe(200);
  });
  it("requires payment idempotency key and rejects unknown plan", async () => {
    const s = await session();
    await complete(s.cookie);
    expect(
      (await api("/pay", "POST", { plan: "premium" }, s.cookie)).status,
    ).toBe(422);
    expect(
      (
        await api("/pay", "POST", { plan: "admin" }, s.cookie, {
          "Idempotency-Key": "bad-plan",
        })
      ).status,
    ).toBe(422);
  });
  it("concurrent completion creates exactly one immutable result", async () => {
    const s = await session();
    await complete(s.cookie);
    const a = await db.assessment.findUniqueOrThrow({
      where: { userId: s.userId },
    });
    await db.assessmentResult.delete({ where: { assessmentId: a.id } });
    await db.assessment.update({
      where: { id: a.id },
      data: { status: "IN_PROGRESS", completedAt: null },
    });
    const replies = await Promise.all(
      [1, 2, 3].map(() =>
        api(
          "/api/v1/assessment/current/complete",
          "POST",
          { version: 6 },
          s.cookie,
        ),
      ),
    );
    expect(replies.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(
      await db.assessmentResult.count({ where: { assessmentId: a.id } }),
    ).toBe(1);
  });
  it("rejects invalid body values and goal direction before DB writes", async () => {
    const s = await session();
    for (let i = 0; i < 3; i++)
      await api(
        "/api/v1/assessment/current/steps/" + steps[i][0],
        "PATCH",
        { ...steps[i][1], version: i },
        s.cookie,
      );
    for (const patch of [
      { heightCm: 0 },
      { heightCm: "170 OR 1=1" },
      { weightKg: 301 },
      { targetWeightKg: 90 },
      { targetWeightKg: 35 },
      { weightKg: 85.123 },
    ]) {
      const r = await api(
        "/api/v1/assessment/current/steps/body",
        "PATCH",
        {
          heightCm: 180,
          weightKg: 85,
          targetWeightKg: 75,
          version: 3,
          ...patch,
        },
        s.cookie,
      );
      expect(r.status).toBe(422);
    }
    expect(
      (await api("/api/v1/assessment/current", "GET", undefined, s.cookie)).body
        .data.version,
    ).toBe(3);
  });
  it("database check constraints reject bypassed numeric validation", async () => {
    const s = await session();
    await expect(
      db.assessment.update({
        where: { userId: s.userId },
        data: { heightCm: 0 },
      }),
    ).rejects.toThrow();
  });
  it("rolls back subscription when recording payment fails", async () => {
    const s = await session();
    await complete(s.cookie);
    await db.$executeRawUnsafe(
      'ALTER TABLE "PaymentEvent" ADD CONSTRAINT test_payment_failure CHECK (amount <> 0) NOT VALID',
    );
    try {
      const r = await api("/pay", "POST", { plan: "premium" }, s.cookie, {
        "Idempotency-Key": "rollback-case",
      });
      expect(r.status).toBe(500);
      expect(await db.paymentEvent.count({ where: { userId: s.userId } })).toBe(
        0,
      );
      expect(
        (
          await db.subscription.findUniqueOrThrow({
            where: { userId: s.userId },
          })
        ).status,
      ).toBe("INACTIVE");
      expect(
        (await api("/api/v1/result", "GET", undefined, s.cookie)).body.data
          .subscriptionRequired,
      ).toBe(true);
    } finally {
      await db.$executeRawUnsafe(
        'ALTER TABLE "PaymentEvent" DROP CONSTRAINT test_payment_failure',
      );
    }
  });
});
