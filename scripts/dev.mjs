import { spawn } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { config } from "dotenv";
config();
mkdirSync("var", { recursive: true });
const file = "var/local-config.json";
if (!existsSync(file))
  writeFileSync(
    file,
    JSON.stringify({
      INTERNAL_SECRET: randomBytes(32).toString("hex"),
      STAFF_PASSWORD: randomBytes(12).toString("base64url"),
    }),
    { mode: 0o600 },
  );
const local = JSON.parse(readFileSync(file, "utf8"));
const env = { ...local, ...process.env };
console.log("Voice Router: http://localhost:3000");
console.log(
  "Local staff password is in var/local-config.json (STAFF_PASSWORD).",
);
const children = ["scenario-service", "gateway", "web"].map((name) => {
  const c = spawn("pnpm", ["--filter", `@voice/${name}`, "dev"], {
    env,
    stdio: ["inherit", "pipe", "pipe"],
  });
  for (const s of [c.stdout, c.stderr])
    s.on("data", (b) => process.stdout.write(`[${name}] ${b}`));
  return c;
});
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500).unref();
}
for (const c of children) c.on("exit", (code) => stop(code || 0));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
