import { z } from "zod";
export const languages = ["ru", "kk", "mixed"] as const;
export type Language = "ru" | "kk";
export type Slots = Record<string, string | number | boolean | string[]>;
export const slotValue = z.union([
  z.string().max(1500),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(100)).max(12),
]);
export const decisionSchema = z
  .object({
    scenarios: z
      .array(
        z
          .object({
            scenario_id: z
              .string()
              .regex(
                /^(SC(0[1-9]|[1-3][0-9]|40)|SYS_(UNCLEAR|OUT_OF_SCOPE|GOODBYE))$/,
              ),
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    alternatives: z
      .array(
        z
          .object({
            scenario_id: z.string().max(30),
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(3),
    language: z.enum(languages),
    reply_language: z.enum(["ru", "kk"]),
    slots: z.record(slotValue),
    is_continuation: z.boolean(),
    reason: z.string().max(500),
    knowledge_topics: z.array(z.string().max(100)).max(5),
  })
  .strict();
export type Decision = z.infer<typeof decisionSchema>;
export const turnSchema = z
  .object({
    text: z.string().trim().min(1).max(4000),
    turn_id: z.string().uuid(),
  })
  .strict();
export type Scenario = {
  scenario_id: string;
  name: string;
  description: string;
  domain: string;
  category: string;
  not_this_if: { condition: string; use_instead: string }[];
  priority: string;
  requires_identification: boolean;
  requires_confirmation: boolean;
  slots: { required: string[]; optional: string[] };
  actions: string[];
  handoff: { when: string; queue: string } | null;
  examples: { ru: string[]; kk: string[] };
  responses: Record<Language, { opening: string; closing: string }>;
};
export type Message = {
  status?: "draft" | "completed" | "interrupted";
  kind?: "greeting";
  session_id?: string;
  id: string;
  role: "client" | "assistant" | "operator";
  text: string;
  at: string;
  turn_id: string;
  delivery: "unknown" | "displayed" | "played" | "interrupted";
};
export type ActionEvent = {
  name: string;
  mode: "read" | "preview" | "execute" | "blocked";
  result: Record<string, unknown>;
  at: string;
  key?: string;
};
export type Pending = {
  turn_id?: string;
  confirmation_ready?: boolean;
  id: string;
  session_id: string;
  scenario: string;
  action: string;
  params: Slots;
  preview: Record<string, unknown>;
  fingerprint: string;
  created_at: string;
};
export type Trace = {
  turn_id: string;
  transcript: string;
  language: string;
  scenarios: Decision["scenarios"];
  alternatives: Decision["alternatives"];
  reason: string;
  slots: Slots;
  actions: ActionEvent[];
  sources: string[];
  latency_ms: {
    router: number;
    core: number;
    response: number | null;
    stt: number | null;
    tts_first_audio: number | null;
    total: number | null;
  };
  blocked?: string;
};
export type CaseState = {
  id: string;
  workspace_id: string;
  client_id: string | null;
  status:
    | "open"
    | "waiting_customer"
    | "waiting_operator"
    | "in_progress"
    | "resolved";
  owner: string | null;
  language: Language;
  active: string | null;
  queue: string[];
  stack: string[];
  slots: Slots;
  pending: Pending | null;
  next_step: string;
  summary: string;
  version: number;
  low_confidence: number;
  resume_candidates: string[];
  created_at: string;
  updated_at: string;
  disconnect_reason: string | null;
};
export type Session = {
  id: string;
  case_id: string;
  workspace_id: string;
  token_hash: string;
  status: string;
  ended_reason: string | null;
  created_at: string;
  last_seen: number;
};
export type Staff = {
  id: string;
  role: "operator" | "supervisor";
  name: string;
};
export type ReplyPlan = {
  kind:
    "ask" | "facts" | "confirm" | "handoff" | "goodbye" | "blocked" | "resume";
  language: Language;
  instruction: string;
  facts: Record<string, unknown>;
  sources: string[];
  question?: string;
};
export type CaseView = {
  case: CaseState;
  messages: Message[];
  traces: Trace[];
  actions: ActionEvent[];
};
export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export const SCHEMA_VERSION = 1;

export const phoneSchema = z
  .string()
  .trim()
  .max(40)
  .transform((v) => v.replace(/[\s()\-]/g, ""))
  .transform((v) =>
    /^8\d{10}$/.test(v) ? "+7" + v.slice(1) : /^7\d{10}$/.test(v) ? "+" + v : v,
  )
  .pipe(z.string().regex(/^\+7\d{10}$/, "invalid_phone"));
export const createSessionSchema = z
  .object({
    phone: phoneSchema,
    locale: z.enum(["ru", "kk", "en"]).default("ru"),
  })
  .strict();

export const liveInputSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("speech_start"), turn_id: z.string().uuid() })
    .strict(),
  z
    .object({
      type: z.literal("audio"),
      turn_id: z.string().uuid(),
      audio: z
        .string()
        .min(1)
        .max(16000)
        .regex(/^[A-Za-z0-9+/]*={0,2}$/),
    })
    .strict(),
  z
    .object({ type: z.literal("speech_end"), turn_id: z.string().uuid() })
    .strict(),
  z
    .object({
      type: z.literal("text"),
      turn_id: z.string().uuid(),
      text: turnSchema.shape.text,
    })
    .strict(),
  z.object({ type: z.literal("cancel") }).strict(),
  z.object({ type: z.literal("input_cancel") }).strict(),
  z
    .object({
      type: z.literal("played"),
      response_id: z.string().uuid(),
      message_id: z.string().uuid(),
    })
    .strict(),
  z.object({ type: z.literal("pong") }).strict(),
]);
export type LiveOutputEvent = {
  type: string;
  session_id: string;
  connection_id: string;
  seq: number;
  turn_id?: string;
  response_id?: string;
  [key: string]: unknown;
};
