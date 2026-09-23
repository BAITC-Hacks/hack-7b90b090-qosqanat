import "../../scripts/env.js";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { OpenAIRouter, narrate, routingInstructions } from "@voice/ai";
import { Store } from "@voice/db";
import { Engine } from "@voice/core";
import { root } from "@voice/knowledge";
const router = new OpenAIRouter();
const data = (name: string) =>
  JSON.parse(
    readFileSync(join(root, "docs/voice_router_dataset", name), "utf8"),
  );
const mode = process.argv[2] || "utterances";
const rows: any[] = [];
if (mode === "utterances") {
  const all = data("dev_utterances.json").utterances;
  const retry = process.argv.includes("--retry");
  const previous = retry
    ? JSON.parse(
        readFileSync(join(root, "evals/artifacts/utterances.json"), "utf8"),
      ).rows
    : [];
  rows.push(...previous.filter((x: any) => !x.error));
  const inputs = retry
    ? all.filter((x: any) =>
        previous.some((p: any) => p.id === x.id && p.error),
      )
    : all;
  let next = 0;
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (next < inputs.length) {
        const u = inputs[next++];
        try {
          const r = await router.route(u.text, {});
          const actual = r.decision.scenarios.map((x) => x.scenario_id);
          rows.push({
            id: u.id,
            expected: u.expected,
            actual,
            primary: actual[0] === u.expected[0],
            exact: [...actual].sort().join() === [...u.expected].sort().join(),
            latency: r.latency,
          });
          console.log(
            u.id,
            rows.at(-1).exact ? "PASS" : "MISS",
            actual.join(","),
          );
        } catch (e) {
          rows.push({
            id: u.id,
            error: e instanceof Error ? e.message : "error",
            exact: false,
            primary: false,
          });
          console.log(u.id, "ERROR");
        }
      }
    }),
  );
} else if (mode === "dialogs") {
  for (const d of data("dialogs_sample.json").dialogs) {
    const store = new Store(":memory:"),
      engine = new Engine(store),
      s = store.createSession(
        data("mock_backend.json").clients?.find(
          (c: any) => c.client_id === d.client_id,
        )?.phone ||
          d.turns.find((t: any) => t.slots?.phone)?.slots.phone ||
          "+77019998888",
      );
    store.start(s.token);
    const turns = [];
    for (const t of d.turns.filter((x: any) => x.role === "client")) {
      try {
        const result = await router.route(t.text, engine.context(s.token));
        const turnId = randomUUID();
        const applied = engine.apply(
          s.token,
          t.text,
          turnId,
          result.decision,
          result.latency,
        );
        const reply = await narrate(applied.plan);
        engine.addReply(s.token, reply, turnId);
        turns.push({
          expected: t.scenarios,
          actual: result.decision.scenarios.map((x) => x.scenario_id),
          kind: applied.plan.kind,
          actions: applied.trace.actions.map((x: any) => ({
            name: x.name,
            mode: x.mode,
          })),
          next: store.get(s.case_id).next_step,
        });
      } catch (e) {
        turns.push({ error: e instanceof Error ? e.message : "error" });
      }
    }
    rows.push({ id: d.dialog_id, turns });
    store.close();
    console.log(d.dialog_id, "completed", turns.length, "turns");
  }
} else throw Error("Use utterances or dialogs");
const dialogTurns = mode === "dialogs" ? rows.flatMap((x) => x.turns) : [];
const report = {
  at: new Date().toISOString(),
  prompt_sha256: createHash("sha256").update(routingInstructions).digest("hex"),
  model: process.env.REALTIME_MODEL || "gpt-realtime-2.1",
  mode,
  total: rows.length,
  ...(mode === "dialogs"
    ? {
        turns: dialogTurns.length,
        exact: dialogTurns.filter(
          (x) =>
            !x.error &&
            JSON.stringify([...x.expected].sort()) ===
              JSON.stringify([...x.actual].sort()),
        ).length,
        primary: dialogTurns.filter(
          (x) => !x.error && x.expected[0] === x.actual[0],
        ).length,
        errors: dialogTurns.filter((x) => x.error).length,
      }
    : {
        exact: rows.filter((x) => x.exact).length,
        primary: rows.filter((x) => x.primary).length,
        errors: rows.filter((x) => x.error).length,
      }),
  rows,
};
mkdirSync(join(root, "evals/artifacts"), { recursive: true });
writeFileSync(
  join(root, "evals/artifacts", mode + ".json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ ...report, rows: undefined }));
