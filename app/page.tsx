"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Step = "age" | "gender" | "goal" | "body" | "activity" | "complete";
type Answers = {
  age: number | null;
  gender: string | null;
  goal: string | null;
  heightCm: number | null;
  weightKg: number | null;
  targetWeightKg: number | null;
  activityLevel: string | null;
};
type Assessment = {
  id: string;
  currentStep: Step;
  completedSteps: Step[];
  progress: number;
  data: Answers;
  version: number;
  status: "IN_PROGRESS" | "COMPLETED";
};
type CurvePoint = { week: number; weightKg: number };
type Result = {
  bmi: number;
  bmiCategory: string;
  subscriptionRequired: boolean;
  bmr?: number;
  tdee?: number;
  recommendedCalories?: number;
  predictedTargetDate?: string | null;
  predictionCurve?: CurvePoint[];
  algorithmVersion?: string;
};
type ApiError = {
  error: {
    code: string;
    message: string;
    details?: Array<{ path: Array<string | number>; message: string }>;
  };
};

let sessionPromise: Promise<void> | null = null;
function ensureSession() {
  if (!sessionPromise)
    sessionPromise = fetch("/api/v1/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(async (response) => {
        if (!response.ok) throw await response.json();
      })
      .catch((error) => {
        sessionPromise = null;
        throw error;
      });
  return sessionPromise;
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const json = await response.json();
  if (!response.ok) throw json;
  return json.data;
}

const stepOrder: Exclude<Step, "complete">[] = [
  "age",
  "gender",
  "goal",
  "body",
  "activity",
];
const headings: Record<Exclude<Step, "complete">, string> = {
  age: "先从年龄开始",
  gender: "你的生理性别是？",
  goal: "此刻最想实现什么？",
  body: "了解你的身体数据",
  activity: "平时的活动量如何？",
};
const choices = {
  gender: [
    ["FEMALE", "女性", "用于估算基础代谢"],
    ["MALE", "男性", "用于估算基础代谢"],
  ],
  goal: [
    ["LOSE_WEIGHT", "减脂", "稳步向目标体重靠近"],
    ["MAINTAIN_WEIGHT", "保持体重", "维持现在的平衡"],
    ["GAIN_WEIGHT", "增重", "循序增加体重"],
  ],
  activity: [
    ["SEDENTARY", "久坐", "很少运动"],
    ["LIGHT", "轻度活动", "每周运动 1–3 次"],
    ["MODERATE", "中等活动", "每周运动 3–5 次"],
    ["ACTIVE", "较高活动", "每周运动 6–7 次"],
    ["VERY_ACTIVE", "高强度活动", "高强度训练或体力工作"],
  ],
};
const categoryLabel: Record<string, string> = {
  UNDERWEIGHT: "偏轻",
  NORMAL: "正常范围",
  OVERWEIGHT: "偏高",
  OBESE: "较高",
};

export default function Home() {
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [activeStep, setActiveStep] = useState<Step>("age");
  const [started, setStarted] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [modal, setModal] = useState(false);
  const [paymentKey, setPaymentKey] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        await ensureSession();
        const current = await api<Assessment>("/api/v1/assessment/current");
        setAssessment(current);
        setActiveStep(current.currentStep);
        if (current.status === "COMPLETED") {
          setStarted(true);
          setResult(await api<Result>("/api/v1/result"));
        } else if (current.progress > 0) setStarted(true);
      } catch (error) {
        setMessage(errorText(error));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal(false);
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = [
          ...dialogRef.current.querySelectorAll<HTMLElement>(
            "button:not([disabled]), [href], input:not([disabled])",
          ),
        ];
        if (!focusable.length) return;
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("keydown", close);
      previous?.focus();
    };
  }, [modal]);

  async function saveStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assessment || activeStep === "complete") return;
    setSaving(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    let fields: Record<string, unknown> = { version: assessment.version };
    if (activeStep === "age") fields.age = Number(data.get("age"));
    if (activeStep === "gender") fields.gender = data.get("gender");
    if (activeStep === "goal") fields.goal = data.get("goal");
    if (activeStep === "body")
      fields = {
        ...fields,
        heightCm: Number(data.get("heightCm")),
        weightKg: Number(data.get("weightKg")),
        targetWeightKg: Number(data.get("targetWeightKg")),
      };
    if (activeStep === "activity")
      fields.activityLevel = data.get("activityLevel");
    try {
      const next = await api<Assessment>(
        `/api/v1/assessment/current/steps/${activeStep}`,
        { method: "PATCH", body: JSON.stringify(fields) },
      );
      setAssessment(next);
      setActiveStep(next.currentStep);
      if (next.currentStep === "complete")
        setResult(
          await api<Result>("/api/v1/assessment/current/complete", {
            method: "POST",
            body: JSON.stringify({ version: next.version }),
          }),
        );
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError?.error?.code === "VERSION_CONFLICT") {
        const latest = await api<Assessment>("/api/v1/assessment/current");
        setAssessment(latest);
        setActiveStep(latest.currentStep);
        setMessage(
          "你的评估已在别处更新，我们已同步到最新进度，请核对后继续。",
        );
      } else setMessage(errorText(error));
    } finally {
      setSaving(false);
    }
  }

  async function unlock() {
    setSaving(true);
    setMessage("");
    const key = paymentKey ?? crypto.randomUUID();
    setPaymentKey(key);
    try {
      await api("/api/v1/pay", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({ plan: "premium" }),
      });
      setResult(await api<Result>("/api/v1/result"));
      setModal(false);
    } catch (error) {
      try {
        const refreshed = await api<Result>("/api/v1/result");
        if (!refreshed.subscriptionRequired) {
          setResult(refreshed);
          setModal(false);
          return;
        }
      } catch {}
      setMessage(
        `模拟解锁暂未完成：${errorText(error)}。再次尝试会安全地使用同一请求。`,
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <main className="center">
        <div className="loader" aria-label="正在准备评估" />
      </main>
    );
  return (
    <main>
      <header className="siteHeader">
        <a className="brand" href="#top" aria-label="青禾健康首页">
          <span>青禾</span> QINGHEALTH
        </a>
        <span className="privacy">匿名评估 · 数据仅用于本次演示</span>
      </header>
      {!started && <Landing onStart={() => setStarted(true)} />}
      {started && !result && assessment && activeStep !== "complete" && (
        <AssessmentForm
          assessment={assessment}
          activeStep={activeStep}
          setActiveStep={setActiveStep}
          onSubmit={saveStep}
          saving={saving}
          message={message}
        />
      )}
      {result && <ResultView result={result} onUnlock={() => setModal(true)} />}
      <footer>
        <span>健康，从理解自己开始。</span>
        <span>Demo only — not medical advice. 仅供演示，不构成医疗建议。</span>
      </footer>
      {modal && (
        <div
          className="modalBackdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(false);
          }}
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pay-title"
            className="modal"
          >
            <button
              className="modalClose"
              aria-label="关闭"
              onClick={() => setModal(false)}
            >
              ×
            </button>
            <span className="eyebrow">PREMIUM PREVIEW</span>
            <h2 id="pay-title">模拟解锁完整报告</h2>
            <p className="price">
              ¥0 <small>演示体验</small>
            </p>
            <p>
              这是支付流程模拟，不会产生实际扣款。解锁后可查看代谢、热量建议与示意趋势。
            </p>
            {message && (
              <div className="notice" role="alert">
                {message}
              </div>
            )}
            <button className="primary wide" onClick={unlock} disabled={saving}>
              {saving ? "正在解锁…" : "确认模拟解锁"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Landing({ onStart }: { onStart: () => void }) {
  return (
    <section id="top" className="landing">
      <div className="heroCopy">
        <span className="eyebrow">A QUIET CHECK-IN</span>
        <h1>
          更了解自己，
          <br />
          才更容易坚持
        </h1>
        <p className="lede">
          用大约 2
          分钟，梳理你的身体状态与目标。没有评判，只有一份清晰、可继续的起点。
        </p>
        <button className="primary" onClick={onStart}>
          开始健康评估 <span aria-hidden="true">→</span>
        </button>
        <div className="trust">
          <span>约 2 分钟</span>
          <span>匿名保存进度</span>
          <span>随时返回修改</span>
        </div>
      </div>
      <div className="motif" aria-hidden="true">
        <div className="sun" />
        <div className="leaf leafOne" />
        <div className="leaf leafTwo" />
        <div className="figure">
          <i />
          <b />
        </div>
        <p>
          listen
          <br />
          <em>to your body</em>
        </p>
      </div>
    </section>
  );
}

function AssessmentForm({
  assessment,
  activeStep,
  setActiveStep,
  onSubmit,
  saving,
  message,
}: {
  assessment: Assessment;
  activeStep: Exclude<Step, "complete">;
  setActiveStep: (s: Step) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  message: string;
}) {
  const index = stepOrder.indexOf(activeStep);
  const data = assessment.data;
  const previous = () => {
    if (index > 0) setActiveStep(stepOrder[index - 1]);
    else setActiveStep(assessment.currentStep);
  };
  return (
    <section className="assessmentShell">
      <aside>
        <span className="eyebrow">YOUR CHECK-IN</span>
        <h2>
          一步一步，
          <br />
          认识现在的自己。
        </h2>
        <p>你的答案用于生成个人化估算。完成前，可以随时回到前面修改。</p>
        <div
          className="progressRail"
          aria-label={`评估进度 ${assessment.progress}%`}
        >
          <i style={{ height: `${Math.max(8, assessment.progress)}%` }} />
        </div>
        <strong>{String(index + 1).padStart(2, "0")}</strong>
        <span>/ 05</span>
      </aside>
      <form className="questionCard" onSubmit={onSubmit}>
        <div className="cardTop">
          <span>问题 {index + 1} / 5</span>
          <span>{assessment.progress}% 已完成</span>
        </div>
        <div className="bar">
          <i style={{ width: `${Math.max(4, assessment.progress)}%` }} />
        </div>
        <span className="questionKicker">
          {["BASICS", "BASICS", "DIRECTION", "BODY", "RHYTHM"][index]}
        </span>
        <h1>{headings[activeStep]}</h1>
        {renderFields(activeStep, data)}
        {message && (
          <div className="notice" role="alert">
            {message}
          </div>
        )}
        <div className="formActions">
          {index > 0 && (
            <button type="button" className="back" onClick={previous}>
              ← 返回
            </button>
          )}
          <button className="primary" disabled={saving}>
            {saving
              ? "正在保存…"
              : activeStep === "activity"
                ? "查看评估结果"
                : "继续"}{" "}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>
    </section>
  );
}

function renderFields(step: Exclude<Step, "complete">, data: Answers) {
  if (step === "age")
    return (
      <>
        <label className="field">
          <span>年龄</span>
          <span className="inputUnit">
            <input
              name="age"
              type="number"
              min="18"
              max="100"
              required
              defaultValue={data.age ?? ""}
              autoFocus
            />
            <b>岁</b>
          </span>
        </label>
        <p className="hint">适用于 18–100 岁成年人</p>
      </>
    );
  if (step === "body")
    return (
      <div className="fieldGrid">
        <NumberField
          name="heightCm"
          label="身高（厘米）"
          unit="cm"
          value={data.heightCm}
        />
        <NumberField
          name="weightKg"
          label="当前体重（公斤）"
          unit="kg"
          value={data.weightKg}
        />
        <NumberField
          name="targetWeightKg"
          label="目标体重（公斤）"
          unit="kg"
          value={data.targetWeightKg}
        />
      </div>
    );
  const group =
    step === "gender"
      ? choices.gender
      : step === "goal"
        ? choices.goal
        : choices.activity;
  const field =
    step === "gender" ? "gender" : step === "goal" ? "goal" : "activityLevel";
  const selected = data[field as keyof Answers];
  return (
    <fieldset className="choices">
      <legend className="srOnly">{headings[step]}</legend>
      {group.map(([value, label, description]) => (
        <label key={value} className="choice">
          <input
            type="radio"
            name={field}
            value={value}
            defaultChecked={selected === value}
            required
          />
          <span className="choiceMark" />
          <span>
            <strong>{label}</strong>
            <small>{description}</small>
          </span>
          <b aria-hidden="true">→</b>
        </label>
      ))}
    </fieldset>
  );
}
function NumberField({
  name,
  label,
  unit,
  value,
}: {
  name: string;
  label: string;
  unit: string;
  value: number | null;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="inputUnit">
        <input
          name={name}
          type="number"
          min={name === "heightCm" ? 120 : 35}
          max={name === "heightCm" ? 230 : 300}
          step="0.01"
          required
          defaultValue={value ?? ""}
        />
        <b>{unit}</b>
      </span>
    </label>
  );
}

function ResultView({
  result,
  onUnlock,
}: {
  result: Result;
  onUnlock: () => void;
}) {
  const circumference = 2 * Math.PI * 72;
  const offset = circumference * (1 - Math.min(result.bmi, 40) / 40);
  return (
    <section className="resultShell">
      <div className="resultIntro">
        <span className="eyebrow">YOUR RESULT</span>
        <h1>你的健康概览</h1>
        <p>这是一张此刻的快照。把数字当作观察的线索，而不是对自己的定义。</p>
      </div>
      <div className="resultGrid">
        <article className="bmiCard">
          <div className="ring">
            <svg viewBox="0 0 170 170" aria-hidden="true">
              <circle cx="85" cy="85" r="72" />
              <circle
                className="value"
                cx="85"
                cy="85"
                r="72"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
              />
            </svg>
            <div>
              <small>BMI</small>
              <strong>{result.bmi.toFixed(1)}</strong>
            </div>
          </div>
          <span className="pill">
            {categoryLabel[result.bmiCategory] ?? result.bmiCategory}
          </span>
          <p>BMI 是身高与体重的基础参考，不代表完整健康状况。</p>
        </article>
        {result.subscriptionRequired ? (
          <article className="unlockCard">
            <span className="lock">✦</span>
            <h2>完整报告已准备好</h2>
            <p>查看基础代谢、每日能量估算，以及通往目标的示意节奏。</p>
            <ul>
              <li>基础代谢与日常消耗</li>
              <li>每日建议热量</li>
              <li>体重趋势示意</li>
            </ul>
            <button className="primary" onClick={onUnlock}>
              解锁完整报告
            </button>
            <small>¥0 模拟体验 · 不会实际扣款</small>
          </article>
        ) : (
          <Premium result={result} />
        )}
      </div>
      <div className="disclaimer">
        <strong>仅供演示，不构成医疗建议</strong>
        <span>
          Demo only — not medical advice.
          如有健康疑虑，请咨询合格的医疗专业人士。
        </span>
      </div>
    </section>
  );
}
function Premium({ result }: { result: Result }) {
  const curve = result.predictionCurve ?? [];
  const values = curve.map((p) => p.weightKg);
  const min = Math.min(...values),
    max = Math.max(...values);
  const points = curve
    .filter(
      (_, i) =>
        i % Math.max(1, Math.ceil(curve.length / 18)) === 0 ||
        i === curve.length - 1,
    )
    .map(
      (p, i, a) =>
        `${a.length === 1 ? 50 : (i / (a.length - 1)) * 100},${max === min ? 50 : 8 + ((max - p.weightKg) / (max - min)) * 72}`,
    )
    .join(" ");
  return (
    <article className="premiumCard">
      <div className="metrics">
        <div>
          <span>基础代谢</span>
          <strong>{result.bmr}</strong>
          <small>kcal / 日</small>
        </div>
        <div>
          <span>每日总消耗</span>
          <strong>{result.tdee}</strong>
          <small>kcal / 日</small>
        </div>
        <div>
          <span>每日建议热量</span>
          <strong>{result.recommendedCalories}</strong>
          <small>kcal / 日</small>
        </div>
      </div>
      <div className="forecast">
        <div>
          <span className="eyebrow">ILLUSTRATIVE FORECAST</span>
          <h2>你的目标节奏</h2>
          <p>
            {result.predictedTargetDate
              ? `预计目标日期 ${new Date(result.predictedTargetDate).toLocaleDateString("zh-CN")}`
              : "保持当前体重，继续观察身体反馈。"}
          </p>
        </div>
        {points && (
          <svg
            viewBox="0 0 100 92"
            preserveAspectRatio="none"
            aria-label="体重变化示意图"
          >
            <polyline points={points} />
          </svg>
        )}
        <strong>示意预测，不构成保证</strong>
        <small>
          估算基于固定速率与当前输入。热量建议含安全下限；极低体重等情况下，该下限可能高于估算的日常消耗。
        </small>
      </div>
    </article>
  );
}

function errorText(error: unknown) {
  const e = error as ApiError;
  if (e?.error) {
    const details = e.error.details?.map((d) => d.message).join("；");
    return details ? `${e.error.message} ${details}` : e.error.message;
  }
  return error instanceof Error ? error.message : "暂时无法完成，请稍后再试";
}
