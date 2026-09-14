import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import pgClient from "pg";

const port = Number(process.env.LOCAL_DB_PORT ?? 54329);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid LOCAL_DB_PORT");
// Never adopt or stop another PostgreSQL process just because it answers our port.
await new Promise<void>((resolveReady, reject) => {
  const probe = createServer();
  probe.once("error", () =>
    reject(
      new Error(
        `Port ${port} is occupied. Use the running database or another LOCAL_DB_PORT.`,
      ),
    ),
  );
  probe.listen(port, "127.0.0.1", () => probe.close(() => resolveReady()));
});
let stop: () => Promise<void> = async () => {};
let cleaned = false;
async function cleanup() {
  if (!cleaned) {
    cleaned = true;
    await stop();
  }
}
try {
  if (process.platform === "win32") {
    const drive = ["Z:", "Y:", "X:", "W:", "V:"].find(
      (d) => !existsSync(d + "/"),
    );
    if (!drive)
      throw new Error("No spare drive letter. Use Docker Compose instead.");
    execFileSync("subst", [drive, process.cwd()], { windowsHide: true });
    const data = process.env.LOCAL_DB_DATA ?? drive + "/.local-postgres";
    const bin =
      drive + "/node_modules/@embedded-postgres/windows-x64/native/bin";
    const password = drive + "/.pg-local-password";

    let started = false;
    stop = async () => {
      try {
        if (started && child.exitCode === null && child.signalCode === null) {
          execFileSync(
            bin + "/pg_ctl.exe",
            ["-D", data, "stop", "-m", "fast"],
            { windowsHide: true },
          );
        }
      } finally {
        execFileSync("subst", [drive, "/D"], { windowsHide: true });
      }
    };
    if (!existsSync(data + "/PG_VERSION")) {
      writeFileSync(password, "health_local_only\n");
      try {
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
        if (init.status !== 0)
          throw new Error("PostgreSQL initialization failed.");
      } finally {
        unlinkSync(password);
      }
    }
    const child = spawn(
      bin + "/postgres.exe",
      [
        "-D",
        data,
        "-h",
        "127.0.0.1",
        "-p",
        String(port),
        "-c",
        "lc_messages=C",
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );

    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("PostgreSQL startup timed out."));
      }, 15000);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (!started)
          reject(
            new Error(`Owned PostgreSQL exited during startup (${code}).`),
          );
      });
      child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
      child.stderr?.on("data", (chunk) => {
        process.stderr.write(chunk);
        if (
          String(chunk).includes(
            "database system is ready to accept connections",
          )
        ) {
          started = true;
          clearTimeout(timer);
          resolveReady();
        }
      });
    });
  } else {
    const databaseDir = resolve(process.env.LOCAL_DB_DATA ?? ".local-postgres");
    mkdirSync(databaseDir, { recursive: true });
    const pg = new EmbeddedPostgres({
      databaseDir,
      user: "health",
      password: "health_local_only",
      port,
      persistent: true,
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      postgresFlags: ["-h", "127.0.0.1"],
    });
    if (!existsSync(resolve(databaseDir, "PG_VERSION"))) await pg.initialise();
    await pg.start();
    stop = () => pg.stop();
  }
  const client = new pgClient.Client({
    connectionString: `postgresql://health:health_local_only@127.0.0.1:${port}/postgres`,
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
  } finally {
    await client.end();
  }
  process.stdout.write(
    `PostgreSQL ready on 127.0.0.1:${port}. Keep this terminal open.\n`,
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, async () => {
      await cleanup();
      process.exit(0);
    });
  if (process.env.LOCAL_DB_VERIFY_ONLY === "true") await cleanup();
  else setInterval(() => {}, 60000);
} catch (error) {
  await cleanup();
  throw error;
}
