import "../../../scripts/env.js";
import express from "express";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import {
  OpenAIRouter,
  RealtimeConnection,
  narrate,
  fallbackReply,
} from "@voice/ai";
import { turnSchema, AppError, type Staff } from "@voice/contracts";
import { mask } from "@voice/core";
import { scenarios } from "@voice/knowledge";
const internal = process.env.INTERNAL_SECRET,
  password = process.env.STAFF_PASSWORD;
if (!internal || internal.length < 24 || !password || password.length < 12)
  throw Error("Configure INTERNAL_SECRET (24+) and STAFF_PASSWORD (12+)");
const origin = process.env.PUBLIC_ORIGIN || "http://localhost:3000",
  url = process.env.SCENARIO_URL || "http://127.0.0.1:3002";
const router = new OpenAIRouter();
async function core(path: string, token?: string, body?: unknown) {
  const r = await fetch(url + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": internal!,
      ...(token ? { "x-session-token": token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  const data: any = await r.json();
  if (!r.ok)
    throw new AppError(data.error?.code || "service_unavailable", r.status);
  return data;
}
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.set("trust proxy", false);
const rates = new Map<string, { at: number; n: number }>();
function rate(key: string, max = 100) {
  const now = Date.now(),
    r = rates.get(key);
  if (!r || r.at < now - 60000) {
    rates.set(key, { at: now, n: 1 });
    return;
  }
  if (++r.n > max) throw new AppError("rate_limited", 429);
}
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.headers.origin && req.headers.origin !== origin)
      throw new AppError("origin_forbidden", 403);
    rate(req.ip || "local", 200);
    next();
  } catch (e) {
    next(e);
  }
});
const wrap =
  (f: (r: express.Request) => Promise<unknown>) =>
  (r: express.Request, s: express.Response, n: express.NextFunction) =>
    void f(r)
      .then((d) => s.json(d))
      .catch(n);
const clientToken = (r: express.Request) => {
  const v = r.header("authorization")?.replace(/^Bearer /, "");
  return z.string().min(40).max(200).parse(v);
};
const staffTokens = new Map<string, { staff: Staff; expires: number }>();
const account = (id: string): Staff => ({
  id,
  role: id === "supervisor" ? "supervisor" : "operator",
  name:
    id === "supervisor"
      ? "Supervisor"
      : id === "operator1"
        ? "Operator 1"
        : "Operator 2",
});
const staff = (r: express.Request) => {
  const cookie = (r.header("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("staff="))
    ?.slice(6);
  const s = cookie ? staffTokens.get(cookie) : undefined;
  if (!s || s.expires < Date.now()) throw new AppError("unauthorized", 401);
  return s.staff;
};
const locks = new Map<string, Promise<unknown>>();
async function serial<T>(key: string, f: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) || Promise.resolve();
  const work = prev.catch(() => {}).then(f);
  locks.set(key, work);
  try {
    return await work;
  } finally {
    if (locks.get(key) === work) locks.delete(key);
  }
}
let active = 0;
let voiceReservations = 0;
async function limited<T>(f: () => Promise<T>) {
  if (active + voiceReservations >= Number(process.env.MAX_ACTIVE_MODELS || 8))
    throw new AppError("busy", 503);
  active++;
  try {
    return await f();
  } finally {
    active--;
  }
}
app.get(
  "/api/health",
  wrap(async () => ({
    ok: true,
    core: (await core("/health")).ok,
    provider_configured: !!process.env.OPENAI_API_KEY,
    model: process.env.REALTIME_MODEL || "gpt-realtime-2.1",
  })),
);
app.get("/api/catalog", (_r, s) =>
  s.json(
    scenarios.map((x) => ({
      id: x.scenario_id,
      description: x.description,
      name: x.name,
      priority: x.priority,
    })),
  ),
);
app.post(
  "/api/sessions",
  wrap(async (r) => {
    rate("create:" + (r.ip || ""), 15);
    return core("/sessions", undefined, {});
  }),
);
app.get(
  "/api/session",
  wrap((r) => core("/session", clientToken(r))),
);
app.post(
  "/api/heartbeat",
  wrap((r) => core("/sessions/touch", clientToken(r), {})),
);
app.post(
  "/api/end",
  wrap((r) =>
    core("/sessions/end", clientToken(r), { reason: "client_ended" }),
  ),
);
app.post(
  "/api/resume",
  wrap((r) =>
    core("/resume", clientToken(r), {
      case_id: z.string().uuid().parse(r.body.case_id),
    }),
  ),
);
app.post(
  "/api/delivery",
  wrap((r) => core("/delivery", clientToken(r), r.body)),
);
async function processTurn(
  token: string,
  text: string,
  turnId: string,
  routeResult?: any,
) {
  await core("/sessions/touch", token, {});
  const before = await core("/session", token);
  if (before.case.owner || before.case.status === "waiting_operator") {
    const neutral = {
      scenarios: [{ scenario_id: before.case.active || "SC37", confidence: 1 }],
      alternatives: [],
      language: before.case.language,
      reply_language: before.case.language,
      slots: {},
      is_continuation: true,
      reason: "Human handoff",
      knowledge_topics: [],
    };
    await core("/turn", token, {
      text,
      turn_id: turnId,
      decision: neutral,
      router_ms: 0,
    });
    return { view: await core("/session", token), message: null };
  }
  const context = await core("/context", token);
  const result = routeResult || (await router.route(text, context));
  const applied = await core("/turn", token, {
    text,
    turn_id: turnId,
    decision: result.decision,
    router_ms: result.latency,
  });
  const responseStart = performance.now();
  let reply: string;
  try {
    reply = await narrate(applied.plan);
  } catch {
    reply = fallbackReply(applied.plan);
  }
  const saved = await core("/reply", token, {
    text: reply,
    turn_id: turnId,
    response_ms: Math.round(performance.now() - responseStart),
  });
  return {
    view: await core("/session", token),
    message: saved.message,
    approved_text: mask(reply),
    call_id: result.call_id,
  };
}
app.post(
  "/api/turn",
  wrap(async (r) => {
    const token = clientToken(r),
      body = turnSchema.parse(r.body);
    rate("turn:" + token, 20);
    return serial(token, () =>
      limited(() => processTurn(token, body.text, body.turn_id)),
    );
  }),
);
app.post("/api/staff/login", async (req, res, next) => {
  try {
    rate("login:" + (req.ip || ""), 8);
    const b = z
      .object({
        id: z.enum(["operator1", "operator2", "supervisor"]),
        password: z.string().max(200),
      })
      .strict()
      .parse(req.body);
    const a = Buffer.from(b.password),
      expected = Buffer.from(password!);
    if (a.length !== expected.length || !timingSafeEqual(a, expected))
      throw new AppError("invalid_credentials", 401);
    const token = randomBytes(32).toString("hex"),
      user = account(b.id);
    staffTokens.set(token, { staff: user, expires: Date.now() + 8 * 3600000 });
    res.setHeader(
      "Set-Cookie",
      `staff=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=28800${origin.startsWith("https:") ? "; Secure" : ""}`,
    );
    res.json(user);
  } catch (e) {
    next(e);
  }
});
app.get(
  "/api/staff/me",
  wrap(async (r) => staff(r)),
);
app.post("/api/staff/logout", (r, s) => {
  const token = (r.header("cookie") || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("staff="))
    ?.slice(6);
  if (token) staffTokens.delete(token);
  s.setHeader(
    "Set-Cookie",
    "staff=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0",
  );
  s.json({ ok: true });
});
app.get(
  "/api/staff/cases",
  wrap((r) => core("/staff/cases", undefined, { staff: staff(r) })),
);
app.get(
  "/api/staff/cases/:id",
  wrap((r) =>
    core("/staff/case", undefined, { staff: staff(r), case_id: r.params.id }),
  ),
);
for (const action of ["claim", "transfer", "reply", "resolve"])
  app.post(
    "/api/staff/cases/:id/" + action,
    wrap((r) => {
      const user = staff(r);
      return core("/staff/" + action, undefined, {
        ...r.body,
        staff: user,
        case_id: r.params.id,
      });
    }),
  );
app.use(
  (
    err: any,
    _r: express.Request,
    s: express.Response,
    _n: express.NextFunction,
  ) =>
    s
      .status(
        err instanceof AppError
          ? err.status
          : err instanceof z.ZodError
            ? 400
            : 502,
      )
      .json({
        error: {
          code:
            err instanceof AppError
              ? err.code
              : err instanceof z.ZodError
                ? "invalid_input"
                : "provider_unavailable",
        },
      }),
);
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 70000 });
server.on("upgrade", (req, socket, head) => {
  if (
    req.url !== "/api/voice" ||
    req.headers.origin !== origin ||
    wss.clients.size >= 32
  ) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
wss.on("connection", (ws) => {
  let token = "",
    conn: RealtimeConnection | null = null,
    audioBytes = 0,
    busy = false,
    authenticated = false;
  let recordingTimeout: ReturnType<typeof setTimeout> | undefined;
  let reserved = false;
  const release = () => {
    clearTimeout(recordingTimeout);
    if (reserved) {
      voiceReservations--;
      reserved = false;
    }
  };
  const authTimeout = setTimeout(() => ws.close(1008), 5000);
  let lastSeen = Date.now();
  const send = (e: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e));
  };
  const heartbeat = setInterval(() => {
    if (Date.now() - lastSeen > 30000) ws.close(1001);
    else send({ type: "ping" });
  }, 10000);
  ws.on("message", async (data) => {
    try {
      const e = JSON.parse(data.toString());
      if (!authenticated) {
        if (e.type !== "auth") throw new AppError("unauthorized", 401);
        token = z.string().min(40).max(200).parse(e.token);
        await core("/sessions/touch", token, {});
        authenticated = true;
        clearTimeout(authTimeout);
        send({ type: "ready" });
        return;
      }
      lastSeen = Date.now();
      if (e.type === "pong") {
        await core("/sessions/touch", token, {});
        return;
      }
      if (e.type === "start") {
        if (busy || conn) throw new AppError("busy", 409);
        busy = true;
        rate("voice:" + token, 20);
        if (
          active + voiceReservations >=
          Number(process.env.MAX_ACTIVE_MODELS || 8)
        )
          throw new AppError("busy", 503);
        voiceReservations++;
        reserved = true;
        const ctx = await core("/context", token);
        if (ctx.case.owner || ctx.case.status === "waiting_operator")
          throw new AppError("human_active", 409);
        conn = new RealtimeConnection(ctx);
        try {
          await conn.ready;
        } catch {
          conn.close();
          conn = new RealtimeConnection(
            ctx,
            process.env.REALTIME_FALLBACK_MODEL || "gpt-realtime",
          );
          await conn.ready;
        }
        audioBytes = 0;
        recordingTimeout = setTimeout(() => {
          release();
          conn?.close();
          conn = null;
          busy = false;
          send({ type: "error", code: "audio_too_long" });
        }, 90000);
        busy = false;
        send({ type: "recording" });
        return;
      }
      if (e.type === "audio") {
        if (!conn || busy) throw new AppError("invalid_state", 409);
        if (
          typeof e.audio !== "string" ||
          e.audio.length > 65536 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(e.audio)
        )
          throw new AppError("invalid_input");
        audioBytes += Buffer.byteLength(e.audio, "base64");
        if (audioBytes > 24000 * 2 * 90)
          throw new AppError("audio_too_long", 413);
        conn.audio(e.audio);
        return;
      }
      if (e.type === "stop") {
        if (!conn || busy || audioBytes < 4800)
          throw new AppError("audio_too_short");
        busy = true;
        clearTimeout(recordingTimeout);
        const current = conn,
          turnId = z.string().uuid().parse(e.turn_id);
        send({ type: "processing" });
        await serial(token, () =>
          (async () => {
            const result = await current.route();
            if (conn !== current || ws.readyState !== WebSocket.OPEN) return;
            send({ type: "transcript", text: result.transcript });
            if (!result.transcript.trim())
              throw new AppError("transcription_failed");
            const output = await processTurn(
              token,
              result.transcript,
              turnId,
              result,
            );
            if (conn !== current || ws.readyState !== WebSocket.OPEN) return;
            send({ type: "result", ...output });
            const latest = await core("/session", token);
            if (output.message && !latest.case.owner) {
              await current.speak(
                output.approved_text!,
                result.call_id,
                (chunk) =>
                  send({
                    type: "audio",
                    audio: chunk,
                    message_id: output.message.id,
                  }),
              );
              send({ type: "audio_done", message_id: output.message.id });
            }
          })(),
        );
        release();
        current.close();
        if (conn === current) conn = null;
        busy = false;
        send({ type: "ready" });
        return;
      }
      if (e.type === "cancel") {
        release();
        conn?.close();
        conn = null;
        busy = false;
        send({ type: "ready" });
        return;
      }
      throw new AppError("invalid_input");
    } catch (err) {
      release();
      conn?.close();
      conn = null;
      busy = false;
      send({
        type: "error",
        code: err instanceof AppError ? err.code : "provider_unavailable",
      });
    }
  });
  ws.on("close", () => {
    release();
    clearTimeout(authTimeout);
    clearInterval(heartbeat);
    conn?.close();
    if (token)
      void core("/sessions/end", token, { reason: "connection_lost" }).catch(
        () => {},
      );
  });
});
server.listen(Number(process.env.GATEWAY_PORT || 3001), "0.0.0.0", () =>
  console.log("Gateway ready"),
);
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rates) if (v.at < now - 60000) rates.delete(k);
  for (const [k, v] of staffTokens) if (v.expires < now) staffTokens.delete(k);
}, 60000).unref();
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    for (const ws of wss.clients) ws.close(1001);
    server.close(() => process.exit(0));
  });
