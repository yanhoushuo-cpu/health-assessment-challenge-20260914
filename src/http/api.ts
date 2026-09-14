import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { authenticate, startSession } from "../auth/session";
import { AppError } from "../errors/app-error";
import {
  assessmentDto,
  completeAssessment,
  currentAssessment,
  getResult,
  saveStep,
} from "../services/assessment";
import { pay } from "../services/payment";
import { completionSchema, stepNames, type Step } from "../validators/steps";
const response = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(
    { data },
    {
      status,
      headers: {
        "Cache-Control": "no-store, private",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
        ...headers,
      },
    },
  );
async function readBody(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_ORIGIN ?? new URL(request.url).origin;
  if (origin && origin !== expected)
    throw new AppError(
      "CROSS_ORIGIN_REQUEST",
      "Cross-origin writes are not allowed.",
      403,
    );
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new AppError(
      "CROSS_ORIGIN_REQUEST",
      "Cross-site writes are not allowed.",
      403,
    );
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Use application/json.", 415);
  if (Number(request.headers.get("content-length")) > 16384)
    throw new AppError("PAYLOAD_TOO_LARGE", "Request exceeds 16 KiB.", 413);
  const reader = request.body?.getReader();
  let raw = "";
  let size = 0;
  const decoder = new TextDecoder();
  if (reader)
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new AppError("PAYLOAD_TOO_LARGE", "Request exceeds 16 KiB.", 413);
      }
      raw += decoder.decode(value, { stream: true });
    }
  raw += decoder.decode();
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
}
export async function handleApi(
  request: Request,
  db: PrismaClient,
): Promise<Response> {
  try {
    const path = new URL(request.url).pathname;
    const method = request.method;
    const body = ["POST", "PATCH"].includes(method)
      ? await readBody(request)
      : undefined;
    if (path === "/api/v1/session" && method === "POST") {
      z.strictObject({}).parse(body);
      const result = await startSession(db, request);
      return response(
        {
          sessionId: result.session.id,
          userId: result.session.userId,
          expiresAt: result.session.expiresAt,
        },
        result.created ? 201 : 200,
        result.cookie ? { "Set-Cookie": result.cookie } : {},
      );
    }
    const identity = await authenticate(db, request);
    if (path === "/api/v1/assessment/current" && method === "GET")
      return response(
        assessmentDto(await currentAssessment(db, identity.userId)),
      );
    const match = path.match(
      /^\/api\/v1\/assessment\/current\/steps\/([^/]+)$/,
    );
    if (match && method === "PATCH") {
      if (!stepNames.includes(match[1] as Step))
        throw new AppError("STEP_NOT_FOUND", "Unknown question.", 404);
      return response(
        await saveStep(db, identity.userId, match[1] as Step, body),
      );
    }
    if (path === "/api/v1/assessment/current/complete" && method === "POST") {
      const { version } = completionSchema.parse(body);
      return response(await completeAssessment(db, identity.userId, version));
    }
    if (path === "/api/v1/result" && method === "GET")
      return response(await getResult(db, identity.userId));
    if (["/api/v1/pay", "/pay"].includes(path) && method === "POST")
      return response(
        await pay(
          db,
          identity.userId,
          body,
          request.headers.get("idempotency-key"),
        ),
      );
    throw new AppError("NOT_FOUND", "Endpoint or method not found.", 404);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2024", "P2028", "P2034"].includes(error.code)
    ) {
      return Response.json(
        {
          error: {
            code: "TEMPORARILY_UNAVAILABLE",
            message:
              "Database is busy. Retry with the same version or payment key.",
          },
        },
        {
          status: 503,
          headers: { "Cache-Control": "no-store", "Retry-After": "1" },
        },
      );
    }
    const known = error instanceof AppError;
    const validation = error instanceof z.ZodError;
    const status = known ? error.status : validation ? 422 : 500;
    const body = {
      error: {
        code: known
          ? error.code
          : validation
            ? "VALIDATION_ERROR"
            : "INTERNAL_ERROR",
        message: known
          ? error.message
          : validation
            ? "Please check the submitted values."
            : "An unexpected error occurred.",
        ...(validation
          ? {
              details: error.issues.map(({ path, message }) => ({
                path,
                message,
              })),
            }
          : {}),
      },
    };
    if (!known && !validation)
      console.error(
        JSON.stringify({
          event: "api_failure",
          requestId: randomUUID(),
          method: request.method,
          path: new URL(request.url).pathname,
          code:
            error instanceof Prisma.PrismaClientKnownRequestError
              ? error.code
              : undefined,
          error: error instanceof Error ? error.name : "UnknownError",
          stack:
            error instanceof Error
              ? error.stack
                  ?.split("\n")
                  .filter((line) => line.trim().startsWith("at "))
                  .join("\n")
              : undefined,
        }),
      );
    return Response.json(body, {
      status,
      headers: { "Cache-Control": "no-store, private", Vary: "Cookie" },
    });
  }
}
