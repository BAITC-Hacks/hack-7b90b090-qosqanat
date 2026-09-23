import "../../../scripts/env.js";
import express from "express";
import { resolve } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Store } from "@voice/db";
import { Engine, mask } from "@voice/core";
import {
  AppError,
  decisionSchema,
  turnSchema,
  type Staff,
} from "@voice/contracts";
import { root, validateCatalog } from "@voice/knowledge";
const secret = process.env.INTERNAL_SECRET;
if (!secret || secret.length < 24)
  throw Error("INTERNAL_SECRET must contain at least 24 characters");
const db = new Store(
  resolve(root, process.env.DATABASE_PATH || "var/voice-router.sqlite"),
);
db.recover();
const engine = new Engine(db);
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "128kb" }));
const eq = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
app.get("/health", (_req, res) =>
  res.json({ ok: true, catalog: validateCatalog() }),
);
app.use((req, res, next) => {
  if (!eq(req.header("x-internal-secret") || "", secret))
    return res.status(401).json({ error: { code: "unauthorized" } });
  next();
});
const wrap =
  (fn: (req: express.Request) => unknown) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      res.json(fn(req));
    } catch (e) {
      next(e);
    }
  };
const token = (r: express.Request) =>
  z.string().min(40).parse(r.header("x-session-token"));
app.post(
  "/sessions",
  wrap(() => db.createSession("demo")),
);
app.post(
  "/sessions/touch",
  wrap((r) => db.touch(token(r))),
);
app.post(
  "/sessions/end",
  wrap((r) => {
    const reason = z
      .enum(["client_ended", "connection_lost", "technical_error"])
      .parse(r.body.reason);
    db.disconnect(token(r), reason);
    return { ok: true };
  }),
);
app.get(
  "/context",
  wrap((r) => engine.context(token(r))),
);
app.get(
  "/session",
  wrap((r) => {
    const s = db.session(token(r));
    const v = db.view(s.case_id);
    return {
      ...v,
      messages: v.messages.map((m) => ({ ...m, text: mask(m.text) })),
    };
  }),
);
app.post(
  "/turn",
  wrap((r) => {
    const body = z
      .object({
        text: turnSchema.shape.text,
        turn_id: turnSchema.shape.turn_id,
        decision: decisionSchema,
        router_ms: z.number().min(0),
      })
      .strict()
      .parse(r.body);
    return engine.apply(
      token(r),
      body.text,
      body.turn_id,
      body.decision,
      body.router_ms,
    );
  }),
);
app.post(
  "/reply",
  wrap((r) => {
    const b = z
      .object({
        text: z.string().min(1).max(6000),
        turn_id: z.string().uuid(),
        response_ms: z.number().min(0).optional(),
      })
      .strict()
      .parse(r.body);
    if (b.response_ms !== undefined) {
      const session = db.session(token(r));
      const trace = db
        .traces(session.case_id)
        .find((t) => t.turn_id === b.turn_id);
      if (trace) {
        trace.latency_ms.response = b.response_ms;
        db.db
          .prepare(
            "UPDATE traces SET data=? WHERE case_id=? AND json_extract(data,'$.turn_id')=?",
          )
          .run(JSON.stringify(trace), session.case_id, b.turn_id);
      }
    }
    return { message: engine.addReply(token(r), b.text, b.turn_id) };
  }),
);
app.post(
  "/delivery",
  wrap((r) => {
    const b = z
      .object({
        message_id: z.string().uuid(),
        status: z.enum(["displayed", "played", "interrupted"]),
        total_ms: z.number().min(0).max(300000).optional(),
      })
      .strict()
      .parse(r.body);
    const s = db.session(token(r));
    db.delivery(s.case_id, b.message_id, b.status);
    if (b.total_ms !== undefined) {
      const traces = db.traces(s.case_id);
      const msg = db.messages(s.case_id).find((m) => m.id === b.message_id);
      const trace = traces.find((t) => t.turn_id === msg?.turn_id);
      if (trace) {
        trace.latency_ms.total = b.total_ms;
        db.db
          .prepare(
            "UPDATE traces SET data=? WHERE case_id=? AND json_extract(data,'$.turn_id')=?",
          )
          .run(JSON.stringify(trace), s.case_id, trace.turn_id);
      }
    }
    return { ok: true };
  }),
);
app.post(
  "/resume",
  wrap((r) => engine.resume(token(r), z.string().uuid().parse(r.body.case_id))),
);
const staff = (r: express.Request) =>
  z
    .object({
      id: z.enum(["operator1", "operator2", "supervisor"]),
      role: z.enum(["operator", "supervisor"]),
      name: z.string(),
    })
    .parse(r.body.staff) as Staff;
app.post(
  "/staff/cases",
  wrap(() => db.list().map((c) => ({ ...c, summary: mask(c.summary) }))),
);
app.post(
  "/staff/case",
  wrap((r) => {
    staff(r);
    const v = db.view(z.string().uuid().parse(r.body.case_id));
    return {
      ...v,
      messages: v.messages.map((m) => ({ ...m, text: mask(m.text) })),
    };
  }),
);
app.post(
  "/staff/claim",
  wrap((r) => engine.claim(z.string().uuid().parse(r.body.case_id), staff(r))),
);
app.post(
  "/staff/transfer",
  wrap((r) =>
    engine.transfer(
      z.string().uuid().parse(r.body.case_id),
      staff(r),
      r.body.target,
    ),
  ),
);
app.post(
  "/staff/reply",
  wrap((r) =>
    engine.operatorReply(
      z.string().uuid().parse(r.body.case_id),
      staff(r),
      z.string().trim().min(1).max(4000).parse(r.body.text),
    ),
  ),
);
app.post(
  "/staff/resolve",
  wrap((r) => {
    const s = staff(r),
      c = db.get(z.string().uuid().parse(r.body.case_id));
    if (s.role !== "supervisor" && c.owner !== s.id)
      throw new AppError("forbidden", 403);
    c.status = "resolved";
    c.pending = null;
    c.next_step = "completed";
    db.save(c);
    return db.view(c.id);
  }),
);
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) =>
    res
      .status(
        err instanceof AppError
          ? err.status
          : err instanceof z.ZodError
            ? 400
            : 500,
      )
      .json({
        error: {
          code:
            err instanceof AppError
              ? err.code
              : err instanceof z.ZodError
                ? "invalid_input"
                : "internal_error",
        },
      }),
);
const server = app.listen(
  Number(process.env.SCENARIO_PORT || 3002),
  "0.0.0.0",
  () => console.log("Scenario service ready"),
);
const interval = setInterval(() => {
  const rows = db.db
    .prepare(
      "SELECT token_hash,case_id,id FROM sessions WHERE status='active' AND last_seen<?",
    )
    .all(Date.now() - 30000) as any[];
  for (const s of rows)
    db.transaction(() => {
      db.db
        .prepare(
          "UPDATE sessions SET status='disconnected',ended_reason='connection_lost' WHERE id=?",
        )
        .run(s.id);
      const c = db.get(s.case_id);
      c.pending = null;
      c.disconnect_reason = "connection_lost";
      if (c.status === "open") c.status = "waiting_customer";
      db.save(c);
    });
}, 10000);
interval.unref();
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, () => {
    clearInterval(interval);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
