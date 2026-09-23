import "./env.js";
import { renameSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { root } from "../packages/knowledge/src/index.js";
// Local-only reset preserves a backup. Stop the services first.
if (process.env.NODE_ENV === "production")
  throw Error("Reset is disabled in production");
try {
  const r = await fetch("http://127.0.0.1:3002/health", {
    signal: AbortSignal.timeout(800),
  });
  if (r.ok) throw Error("Stop the local services before resetting");
} catch (e) {
  if (e instanceof Error && e.message.startsWith("Stop")) throw e;
}
const path = resolve(root, "var/voice-router.sqlite"),
  stamp = Date.now();
for (const suffix of ["", "-wal", "-shm"])
  if (existsSync(path + suffix))
    renameSync(path + suffix, path + ".backup-" + stamp + suffix);
console.log(
  "Local database archived. A fresh demo will be created on next start.",
);
