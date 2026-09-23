import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";
let text = existsSync(".env")
  ? readFileSync(".env", "utf8")
  : readFileSync(".env.example", "utf8");
const values = parse(text);
const local = existsSync("var/local-config.json")
  ? JSON.parse(readFileSync("var/local-config.json", "utf8"))
  : {};
for (const key of ["INTERNAL_SECRET", "STAFF_PASSWORD"])
  if (!values[key]) {
    const value = local[key] || randomBytes(24).toString("hex");
    const pattern = new RegExp("^" + key + "=.*$", "m");
    text = pattern.test(text)
      ? text.replace(pattern, key + "=" + value)
      : text.trimEnd() + "\n" + key + "=" + value + "\n";
  }
writeFileSync(".env", text, { mode: 0o600 });
chmodSync(".env", 0o600);
console.log(
  "Server secrets are configured in .env. Add OPENAI_API_KEY if it is not set.",
);
