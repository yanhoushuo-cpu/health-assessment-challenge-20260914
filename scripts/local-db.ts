import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import pgClient from "pg";
let stop: () => Promise<void>;
if (process.platform === "win32") {
  const drive = ["Z:", "Y:", "X:", "W:", "V:"].find(
    (d) => !existsSync(d + "/"),
  );
  if (!drive)
    throw new Error("No spare drive letter. Use Docker Compose instead.");
  execFileSync("subst", [drive, process.cwd()], { windowsHide: true });
  const data = drive + "/.local-postgres";
  const bin = drive + "/node_modules/@embedded-postgres/windows-x64/native/bin";
  const password = drive + "/.pg-local-password";
  try {
    if (!existsSync(data + "/PG_VERSION")) {
      writeFileSync(password, "health_local_only\n");
      const init = spawnSync(
        bin + "/initdb.exe",
        [
          "-D",
          data,
          "-U",
          "health",
          "--pwfile=" + password,
          "--auth=scram-sha-256",
          "--encoding=UTF8",
          "--locale=C",
        ],
        { stdio: "inherit", windowsHide: true },
      );
      unlinkSync(password);
      if (init.status !== 0)
        throw new Error("PostgreSQL initialization failed.");
    }
    const child = spawn(
      bin + "/postgres.exe",
      ["-D", data, "-h", "127.0.0.1", "-p", "54329"],
      { stdio: "inherit", windowsHide: true },
    );
    child.on("error", (error) => {
      throw error;
    });
    stop = async () => {
      execFileSync(bin + "/pg_ctl.exe", ["-D", data, "stop", "-m", "fast"], {
        windowsHide: true,
      });
      execFileSync("subst", [drive, "/D"], { windowsHide: true });
    };
  } catch (error) {
    execFileSync("subst", [drive, "/D"], { windowsHide: true });
    throw error;
  }
} else {
  const databaseDir = resolve(".local-postgres");
  mkdirSync(databaseDir, { recursive: true });
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: "health",
    password: "health_local_only",
    port: 54329,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-h", "127.0.0.1"],
  });
  if (!existsSync(resolve(databaseDir, "PG_VERSION"))) await pg.initialise();
  await pg.start();
  stop = () => pg.stop();
}
let ready = false;
for (let attempt = 0; attempt < 40; attempt++) {
  const client = new pgClient.Client({
    connectionString:
      "postgresql://health:health_local_only@127.0.0.1:54329/postgres",
  });
  try {
    await client.connect();
    for (const name of ["health", "health_test"]) {
      const found = await client.query(
        "SELECT 1 FROM pg_database WHERE datname=$1",
        [name],
      );
      if (!found.rowCount) await client.query(`CREATE DATABASE ${name}`);
    }
    ready = true;
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 250));
  } finally {
    await client.end();
  }
}
if (!ready) {
  await stop();
  throw new Error("PostgreSQL did not become ready.");
}
process.stdout.write(
  "PostgreSQL ready on 127.0.0.1:54329. Keep this terminal open.\n",
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    await stop();
    process.exit(0);
  });
setInterval(() => {}, 60000);
