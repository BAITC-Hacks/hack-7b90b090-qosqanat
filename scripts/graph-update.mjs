import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
const bundled = homedir() + "/.local/share/uv/tools/graphifyy/bin/python";
const python =
  process.env.GRAPHIFY_PYTHON || (existsSync(bundled) ? bundled : "python3");
const r = spawnSync(python, ["scripts/graph-docs.py", "--code"], {
  stdio: "inherit",
});
process.exit(r.status ?? 1);
