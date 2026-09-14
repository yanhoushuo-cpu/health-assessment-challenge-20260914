import { expect, test } from "@playwright/test";

test("completes, resumes, keeps the free response private, and unlocks the premium result", async ({
  page,
}) => {
  await page.route(
    "**/api/v1/assessment/current",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "TEMPORARY_FAILURE", message: "请稍后重试。" },
        }),
      }),
    { times: 1 },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "暂时无法载入评估" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重新载入" }).click();
  await expect(
    page.getByRole("heading", { name: /更了解自己，\s*才更容易坚持/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "开始健康评估" }).click();

  await page.getByLabel("年龄").fill("32");
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByLabel("女性").check();
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByLabel("减脂").check();
  await page.getByRole("button", { name: "继续" }).click();
  await page.getByLabel("身高（厘米）").fill("165");
  await page.getByLabel("当前体重（公斤）").fill("68");
  await page.getByLabel("目标体重（公斤）").fill("60");
  await page.getByRole("button", { name: "继续" }).click();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "平时的活动量如何？" }),
  ).toBeVisible();
  await page.getByLabel("中等活动").check();
  await page.route(
    "**/api/v1/assessment/current/complete",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "TEMPORARY_FAILURE", message: "请稍后重试。" },
        }),
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "查看评估结果" }).click();
  await expect(
    page.getByRole("heading", { name: "答案已准备好" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "生成健康概览" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "生成健康概览" }).click();

  await expect(
    page.getByRole("heading", { name: "你的健康概览" }),
  ).toBeVisible();
  await expect(
    page.getByText("仅供演示，不构成医疗建议", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "你的健康概览" }),
  ).toBeVisible();

  const freeResponse = await page.request.get("/api/v1/result");
  const freeJson = await freeResponse.json();
  expect(Object.keys(freeJson.data).sort()).toEqual([
    "bmi",
    "bmiCategory",
    "subscriptionRequired",
  ]);

  await page.getByRole("button", { name: "解锁完整报告" }).click();
  await expect(
    page.getByRole("dialog", { name: "模拟解锁完整报告" }),
  ).toContainText("¥0");
  await page.getByRole("button", { name: "确认模拟解锁" }).click();
  await expect(page.getByText("每日建议热量")).toBeVisible();
  await expect(page.getByText("示意预测，不构成保证")).toBeVisible();

  const paidResponse = await page.request.get("/api/v1/result");
  const paidJson = await paidResponse.json();
  expect(paidJson.data.subscriptionRequired).toBe(false);
  expect(paidJson.data).toEqual(
    expect.objectContaining({
      bmi: expect.any(Number),
      bmr: expect.any(Number),
      tdee: expect.any(Number),
      recommendedCalories: expect.any(Number),
      algorithmVersion: expect.any(String),
      predictionCurve: expect.any(Array),
    }),
  );
});

test("recovers when another tab completes and the first result read fails", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "开始健康评估" })).toBeVisible();
  let current = (await (await page.request.get("/api/v1/assessment/current")).json()).data;
  for (const [step, fields] of [
    ["age", { age: 32 }],
    ["gender", { gender: "FEMALE" }],
    ["goal", { goal: "LOSE_WEIGHT" }],
    ["body", { heightCm: 165, weightKg: 68, targetWeightKg: 60 }],
    ["activity", { activityLevel: "MODERATE" }],
  ] as const) {
    const response = await page.request.patch(
      `/api/v1/assessment/current/steps/${step}`,
      { data: { version: current.version, ...fields } },
    );
    expect(response.ok()).toBe(true);
    current = (await response.json()).data;
  }
  await page.reload();
  await expect(page.getByRole("button", { name: "生成健康概览" })).toBeVisible();
  await page.route(
    "**/api/v1/assessment/current/complete",
    async (route) => {
      expect((await route.fetch()).ok()).toBe(true);
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "VERSION_CONFLICT", message: "评估已更新。" },
        }),
      });
    },
    { times: 1 },
  );
  await page.route(
    "**/api/v1/result",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "TEMPORARY_FAILURE", message: "请稍后重试。" },
        }),
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "生成健康概览" }).click();
  await expect(page.getByText("请稍后重试。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "生成健康概览" }).click();
  await expect(page.getByRole("heading", { name: "你的健康概览" })).toBeVisible();
});

test("stays usable without horizontal overflow on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "开始健康评估" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
