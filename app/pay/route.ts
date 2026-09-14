import { db } from "../../src/lib/db";
import { handleApi } from "../../src/http/api";
export const runtime = "nodejs";
export const POST = (request: Request) => handleApi(request, db);
