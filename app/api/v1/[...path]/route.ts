import { db } from "../../../../src/lib/db";
import { handleApi } from "../../../../src/http/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleApi(request, db);
export const POST = (request: Request) => handleApi(request, db);
export const PATCH = (request: Request) => handleApi(request, db);
