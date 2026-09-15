import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";

// This is an isolated container acceptance test, never a production reset tool.
const base = process.env.DEPLOYMENT_TEST_URL ?? "http://127.0.0.1:3300";
assert.equal(
  new URL(base).hostname,
  "127.0.0.1",
  "Use the isolated local container stack.",
);
const stateFile = new URL(
  "../../test-results/deployment-session.json",
  import.meta.url,
);
const phase = process.argv[2] ?? "prepare";
assert.ok(["prepare", "verify-restart"].includes(phase));
async function api(
  path,
  { cookie, method = "GET", body, headers = {}, status = 200 } = {},
) {
  const result = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(
    result.status,
    status,
    `${method} ${path}: expected ${status}, got ${result.status}`,
  );
  assert.match(result.headers.get("cache-control") ?? "", /no-store/);
  return { data: (await result.json()).data, headers: result.headers };
}

if (phase === "verify-restart") {
  const { cookie, sessionId, paymentId, resultBefore, expiresAt } = JSON.parse(
    await readFile(stateFile, "utf8"),
  );
  const resumed = await api("/api/v1/session", {
    cookie,
    method: "POST",
    body: {},
  });
  assert.equal(resumed.data.sessionId, sessionId);
  assert.deepEqual(
    (await api("/api/v1/result", { cookie })).data,
    resultBefore,
  );
  const replay = await api("/pay", {
    cookie,
    method: "POST",
    body: { plan: "premium" },
    headers: { "Idempotency-Key": "container-payment-001" },
  });
  assert.equal(replay.data.paymentId, paymentId);
  assert.equal(replay.data.expiresAt, expiresAt);
  console.log(
    "PASS: session, persisted result and payment replay survive app + PostgreSQL restart.",
  );
} else {
  await api("/api/v1/result", { status: 401 });
  const fresh = await api("/api/v1/session", {
    method: "POST",
    body: {},
    status: 201,
  });
  const setCookie = fresh.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const cookie = setCookie.split(";")[0];
  await api("/api/v1/assessment/current/steps/age", {
    cookie,
    method: "PATCH",
    body: { version: 0, age: "30" },
    status: 422,
  });
  await api("/api/v1/assessment/current/steps/age", {
    cookie,
    method: "PATCH",
    body: { version: 0, age: 30 },
    headers: { Origin: "https://attacker.invalid" },
    status: 403,
  });
  let version = 0;
  for (const [step, body] of [
    ["age", { age: 30 }],
    ["gender", { gender: "MALE" }],
    ["goal", { goal: "LOSE_WEIGHT" }],
    ["body", { heightCm: 180, weightKg: 85, targetWeightKg: 75 }],
    ["activity", { activityLevel: "MODERATE" }],
  ]) {
    const saved = await api(`/api/v1/assessment/current/steps/${step}`, {
      cookie,
      method: "PATCH",
      body: { version, ...body },
    });
    version = saved.data.version;
    assert.equal(
      (await api("/api/v1/assessment/current", { cookie })).data.version,
      version,
    );
  }
  const free = await api("/api/v1/assessment/current/complete", {
    cookie,
    method: "POST",
    body: { version },
  });
  assert.deepEqual(Object.keys(free.data).sort(), [
    "bmi",
    "bmiCategory",
    "subscriptionRequired",
  ]);
  assert.equal(free.data.bmi, 26.2);
  const payments = await Promise.all(
    Array.from({ length: 2 }, () =>
      api("/pay", {
        cookie,
        method: "POST",
        body: { plan: "premium" },
        headers: { "Idempotency-Key": "container-payment-001" },
      }),
    ),
  );
  assert.equal(payments[0].data.paymentId, payments[1].data.paymentId);
  const paid = await api("/api/v1/result", { cookie });
  assert.equal(paid.data.subscriptionRequired, false);
  assert.equal(paid.data.bmr, 1830);
  assert.ok(
    Array.isArray(paid.data.predictionCurve) &&
      paid.data.predictionCurve.length > 1,
  );
  const other = await api("/api/v1/session", {
    method: "POST",
    body: {},
    status: 201,
  });
  await api("/api/v1/result", {
    cookie: other.headers.get("set-cookie").split(";")[0],
    status: 404,
  });
  await mkdir(new URL("../../test-results/", import.meta.url), {
    recursive: true,
  });
  await writeFile(
    stateFile,
    JSON.stringify({
      cookie,
      sessionId: fresh.data.sessionId,
      paymentId: payments[0].data.paymentId,
      expiresAt: payments[0].data.expiresAt,
      resultBefore: paid.data,
    }),
  );
  console.log(
    "PASS: container auth, validation, incremental persistence, free DTO, concurrent /pay and paid result.",
  );
}
