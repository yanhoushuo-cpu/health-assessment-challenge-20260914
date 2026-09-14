import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { AppError } from "../errors/app-error";
import { transactionOptions } from "../repositories/assessment";
export const COOKIE = "health_session";
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function readToken(request: Request) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
}
export async function authenticate(db: PrismaClient, request: Request) {
  const token = readToken(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new AppError(
      "UNAUTHORIZED",
      "Please start or resume your assessment.",
      401,
    );
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!session)
    throw new AppError("UNAUTHORIZED", "Session is not valid.", 401);
  if (session.expiresAt.getTime() <= Date.now())
    throw new AppError(
      "SESSION_EXPIRED",
      "Your session expired. Start a new assessment.",
      401,
    );
  return session;
}
export async function startSession(db: PrismaClient, request: Request) {
  if (readToken(request)) {
    try {
      return { session: await authenticate(db, request), created: false };
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
    }
  }
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 86400000);
  const session = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { assessment: { create: {} }, subscription: { create: {} } },
    });
    return tx.session.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
    });
  }, transactionOptions);
  return {
    session,
    created: true,
    cookie: `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  };
}
