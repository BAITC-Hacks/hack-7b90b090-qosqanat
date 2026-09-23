import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { Scenario } from "@voice/contracts";
export const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export const dataDir =
  process.env.DATA_DIR || resolve(root, "docs/voice_router_dataset");
export const readData = (name: string) =>
  JSON.parse(readFileSync(resolve(dataDir, name + ".json"), "utf8"));
export const scenarios: Scenario[] = readData("scenarios").scenarios;
export const systems = readData("scenarios").system_intents as {
  id: string;
  description: string;
  response: Record<string, string>;
}[];
export const slots = readData("slots").slots as {
  name: string;
  type: string;
  pattern?: string;
  values?: (string | number)[];
  prompt: Record<string, string>;
}[];
export const actions = readData("actions").actions as {
  name: string;
  inputs: string[];
  outputs: string[];
  irreversible: boolean;
  errors: string[];
}[];
export const kb = readData("knowledge_base");
export const seed = readData("mock_backend");
export const queues: string[] = readData("actions").queues;
export const AS_OF = "2026-10-01";
export const version = createHash("sha256")
  .update(JSON.stringify([scenarios, slots, actions, kb, seed]))
  .digest("hex")
  .slice(0, 16);
export function validateCatalog() {
  const ids = new Set([
      ...scenarios.map((s) => s.scenario_id),
      ...systems.map((s) => s.id),
    ]),
    sn = new Set(slots.map((s) => s.name)),
    an = new Set(actions.map((a) => a.name));
  for (const s of scenarios) {
    for (const n of [...s.slots.required, ...s.slots.optional])
      if (!sn.has(n)) throw Error("Unknown slot " + n);
    for (const n of s.actions)
      if (!an.has(n)) throw Error("Unknown action " + n);
    for (const n of s.not_this_if)
      if (!ids.has(n.use_instead)) throw Error("Unknown boundary");
    if (
      s.actions.some((n) => actions.find((a) => a.name === n)?.irreversible) &&
      !s.requires_confirmation
    )
      throw Error("Missing confirmation");
  }
  for (const [scenario, paths] of Object.entries(topics)) {
    if (!ids.has(scenario))
      throw Error("Unknown knowledge scenario " + scenario);
    for (const path of paths)
      if (knowledgeValue(path) === undefined)
        throw Error("Unknown knowledge path " + scenario + ": " + path);
  }
  for (const path of Object.values(claimDocumentPaths))
    if (knowledgeValue(path) === undefined)
      throw Error("Unknown claim document path " + path);
  return {
    scenarios: scenarios.length,
    slots: slots.length,
    actions: actions.length,
    version,
  };
}
export const topics: Record<string, string[]> = {
  SC01: ["products.ogpo"],
  SC02: ["products.ogpo"],
  SC03: ["products.casco"],
  SC04: ["products.ogpo.pricing"],
  SC05: ["products.ogpo.pricing"],
  SC06: ["products.travel"],
  SC07: ["products.property"],
  SC08: ["products.accident"],
  SC09: ["products.dms"],
  SC10: ["company"],
  SC11: ["claims.road_accident_now", "claims.notify_deadline"],
  SC12: [
    "claims.documents.ogpo_victim",
    "claims.submission",
    "claims.notify_deadline",
  ],
  SC13: [
    "claims.documents.casco",
    "claims.submission",
    "claims.notify_deadline",
  ],
  SC14: [
    "claims.documents.property",
    "claims.submission",
    "claims.notify_deadline",
  ],
  SC15: [
    "products.travel.notes",
    "company.contact_center",
    "claims.notify_deadline",
  ],
  SC16: ["claims.documents.accident", "claims.notify_deadline"],
  SC17: ["claims.decision_time", "claims.payout_time"],
  SC18: ["claims.documents", "claims.submission", "claims.notify_deadline"],
  SC19: ["claims.dispute"],
  SC20: ["inspection_points"],
  SC21: ["clinics", "products.dms.packages"],
  SC22: ["products.dms.packages"],
  SC23: ["clinics"],
  SC24: ["products.dms.e_card"],
  SC25: [],
  SC26: ["products.ogpo.policy_delivery"],
  SC27: ["payments.installments"],
  SC28: ["cancellation"],
  SC29: [],
  SC30: [],
  SC31: ["payments"],
  SC32: ["bonus_malus", "products.ogpo.pricing"],
  SC33: ["offices"],
  SC34: ["app_help"],
  SC35: ["complaints"],
  SC36: ["company.contact_center"],
  SC37: [],
  SC38: ["fraud_policy"],
  SC39: ["documents_available"],
  SC40: ["products"],
};
const claimDocumentPaths: Record<string, string> = {
  ogpo: "claims.documents.ogpo_victim",
  casco: "claims.documents.casco",
  travel: "claims.documents.travel",
  property: "claims.documents.property",
  accident: "claims.documents.accident",
};
function knowledgeValue(path: string): unknown {
  let value: any = kb;
  for (const part of path.split(".")) {
    if (["__proto__", "constructor", "prototype"].includes(part))
      return undefined;
    value =
      value != null && Object.hasOwn(value, part) ? value[part] : undefined;
  }
  return value;
}
export function lookup(
  scenario: string,
  extra: string[] = [],
  product?: string,
) {
  // Narrow before accepting model-proposed topics, so extras cannot widen access.
  const allowed = (
    Object.hasOwn(topics, scenario) ? topics[scenario]! : []
  ).flatMap((path) => {
    if (scenario === "SC18" && path === "claims.documents")
      return product && Object.hasOwn(claimDocumentPaths, product)
        ? [claimDocumentPaths[product]!]
        : [];
    if (path === "products" && product && Object.hasOwn(kb.products, product))
      return [path + "." + product];
    return [path];
  });
  const paths = [
    ...new Set([
      ...allowed,
      ...extra.filter((p) =>
        allowed.some((t) => p === t || p.startsWith(t + ".")),
      ),
    ]),
  ];
  const facts: Record<string, unknown> = {};
  const sources: string[] = [];
  for (const p of paths) {
    const value = knowledgeValue(p);
    if (value !== undefined) {
      facts[p] = value;
      sources.push("knowledge_base.json#/" + p.replaceAll(".", "/"));
    }
  }
  return { facts, sources };
}
export const catalogPrompt =
  JSON.stringify(
    scenarios.map((s) => ({
      id: s.scenario_id,
      description: s.description,
      not_this_if: s.not_this_if,
      priority: s.priority,
      slots: s.slots,
      examples: {
        ru: s.examples.ru.slice(0, 1),
        kk: s.examples.kk.slice(0, 1),
      },
    })),
  ) +
  "\n" +
  JSON.stringify(systems) +
  "\nSLOT SCHEMAS: " +
  JSON.stringify(
    slots.map(({ name, type, values, pattern }) => ({
      name,
      type,
      values,
      pattern,
    })),
  );
validateCatalog();
