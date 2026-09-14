import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";
const value = process.env.TEST_DATABASE_URL;
if (!value)
  throw new Error("Set TEST_DATABASE_URL to a dedicated PostgreSQL database.");
const target = new URL(value);
if (!target.pathname.endsWith("_test"))
  throw new Error(
    "Test database name must end in _test. No production reset is allowed.",
  );
const schema = "test_" + randomUUID().replaceAll("-", "");
const admin = new pg.Client({ connectionString: value });
await admin.connect();
await admin.query(`CREATE SCHEMA "${schema}"`);
target.searchParams.set("schema", schema);
target.searchParams.set("connection_limit", "2");
const env = {
  ...process.env,
  DATABASE_URL: target.toString(),
  DEMO_MODE: "true",
};
delete env.APP_ORIGIN;
function run(module, args) {
  const r = spawnSync(process.execPath, [module, ...args], {
    env,
    stdio: "inherit",
  });
  if (r.status !== 0)
    throw new Error(`Command failed (${r.status}): ${module}`);
}
try {
  run("node_modules/prisma/build/index.js", ["migrate", "deploy"]);
  const mode = process.argv[2];
  if (mode === "e2e") run("node_modules/@playwright/test/cli.js", ["test"]);
  else
    run("node_modules/vitest/vitest.mjs", [
      "run",
      ...(mode === "integration"
        ? ["tests/integration"]
        : mode === "coverage"
          ? ["--coverage"]
          : []),
    ]);
} finally {
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
