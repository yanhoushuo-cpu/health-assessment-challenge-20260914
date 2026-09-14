import { expect, test } from "@playwright/test";

test("completes, resumes, keeps the free response private, and unlocks the premium result", async ({
  page,
}) => {
  await page.goto("/");
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
  await page.getByRole("button", { name: "查看评估结果" }).click();

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
