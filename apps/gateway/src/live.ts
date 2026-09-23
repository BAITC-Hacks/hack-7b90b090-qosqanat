import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { AppError, liveInputSchema } from "@voice/contracts";
import {
  LiveTranscriber,
  RealtimeConnection,
  OpenAIRouter,
  narrateStream,
  fallbackReply,
} from "@voice/ai";
import { mask } from "@voice/core";
import { z } from "zod";
type Dependencies = {
  core: (path: string, token?: string, body?: unknown) => Promise<any>;
  serial: <T>(key: string, f: () => Promise<T>) => Promise<T>;
  limited: <T>(f: () => Promise<T>) => Promise<T>;
  rate: (key: string, max: number) => void;
  reserve: () => () => void;
};
type Job = {
  id: string;
  turn: string;
  abort: AbortController;
  text: string;
  message?: any;
  tts?: RealtimeConnection;
  done?: Promise<void>;
  played: boolean;
  outputDone?: boolean;
};
const safe = (text: string) =>
  mask(text).replace(/([\w.+-])[\w.+-]*@([\w.-]+\.[a-z]{2,})/gi, "$1***@$2");
export function liveConnection(
  ws: WebSocket,
  { core, serial, limited, rate, reserve }: Dependencies,
) {
  let token = "",
    sessionId = "",
    caseId = "",
    seq = 0,
    closed = false,
    stt: LiveTranscriber | null = null,
    release: (() => void) | undefined;
  let speechConnection: RealtimeConnection | null = null;
  let job: Job | null = null,
    input: { id: string; bytes: number; at: number } | null = null,
    committing: Promise<void> = Promise.resolve(),
    commands = Promise.resolve(),
    backlog = 0;
  const connectionId = randomUUID(),
    seen = new Set<string>();
  let lastSeen = Date.now();
  const send = (event: Record<string, unknown>) => {
    if (!closed && ws.readyState === WebSocket.OPEN)
      ws.send(
        JSON.stringify({
          ...event,
          session_id: sessionId,
          connection_id: connectionId,
          seq: ++seq,
        }),
      );
  };
  const error = (e: unknown) =>
    send({
      type: "error",
      code:
        e instanceof AppError
          ? e.code
          : e instanceof Error
            ? e.message
            : "provider_unavailable",
    });
  const state = async () => {
    const v = await core("/session", token);
    if (v.session_status !== "active" || v.case.id !== caseId)
      throw new AppError("session_closed", 409);
    if (v.case.owner || v.case.status === "waiting_operator")
      throw new AppError("human_active", 409);
    return v;
  };
  const cancel = () => {
    const j = job;
    if (!j || j.played || j.abort.signal.aborted) return;
    j.abort.abort();
    j.tts?.close();
    send({
      type: "response.cancelled",
      response_id: j.id,
      turn_id: j.turn,
      message_id: j.message?.id,
    });
    void serial(token, () =>
      core("/stream/cancel", token, { turn_id: j.turn }),
    ).catch(() => {});
  };
  const speak = async (j: Job, text: string, firstAudio?: () => void) => {
    j.abort.signal.throwIfAborted();
    await state();
    j.abort.signal.throwIfAborted();
    if (!j.tts) {
      j.tts = speechConnection || new RealtimeConnection({});
      speechConnection = null;
    }
    let received = false;
    await j.tts.speak(text, undefined, (audio) => {
      if (!received) {
        received = true;
        firstAudio?.();
      }
      if (!j.abort.signal.aborted && job === j)
        send({
          type: "audio",
          response_id: j.id,
          turn_id: j.turn,
          message_id: j.message?.id,
          audio,
        });
    });
    if (!received) throw new AppError("speech_failed", 502);
  };
  const process = async (j: Job, text: string) => {
    let applied = false,
      speech = Promise.resolve(),
      speechError: unknown;
    try {
      await limited(async () => {
        const signal = j.abort.signal;
        signal.throwIfAborted();
        await state();
        signal.throwIfAborted();
        send({ type: "processing", turn_id: j.turn, response_id: j.id });
        const context = await core("/context", token);
        const route = await new OpenAIRouter().route(text, context, signal);
        signal.throwIfAborted();
        await state();
        signal.throwIfAborted();
        const output = await core("/turn", token, {
          text,
          turn_id: j.turn,
          decision: route.decision,
          router_ms: route.latency,
          streaming: true,
        });
        applied = true;
        signal.throwIfAborted();
        send({
          type: "result",
          view: await core("/session", token),
          turn_id: j.turn,
          response_id: j.id,
        });
        const append = async (part: string) => {
          signal.throwIfAborted();
          await state();
          signal.throwIfAborted();
          const chunk = safe(part);
          j.text += chunk;
          const saved = await core("/stream/reply", token, {
            turn_id: j.turn,
            text: j.text,
            status: "draft",
          });
          signal.throwIfAborted();
          if (!saved.message) throw new AppError("human_active", 409);
          j.message = saved.message;
          send({
            type: "response.delta",
            turn_id: j.turn,
            response_id: j.id,
            message: j.message,
          });
          let began!: () => void, failed!: (e: unknown) => void;
          const firstAudio = new Promise<void>((resolve, reject) => {
            began = resolve;
            failed = reject;
          });
          speech = speech
            .then(() => speak(j, chunk, began))
            .catch((e) => {
              speechError = e;
              failed(e);
            });
          // Apply backpressure at sentence boundaries: text cannot outrun spoken output.
          await firstAudio;
        };
        try {
          for await (const part of narrateStream(output.plan, signal)) {
            if (speechError) throw speechError;
            await append(part);
          }
        } catch (e) {
          if (signal.aborted || j.text) throw e;
          await append(fallbackReply(output.plan));
        }
        signal.throwIfAborted();
        const saved = await core("/stream/reply", token, {
          turn_id: j.turn,
          text: j.text,
          status: "completed",
        });
        j.message = saved.message;
        if (!j.message) throw new AppError("human_active", 409);
        send({
          type: "response.done",
          turn_id: j.turn,
          response_id: j.id,
          message: j.message,
        });
        await speech;
        if (speechError) throw speechError;
        signal.throwIfAborted();
        await state();
        j.outputDone = true;
        send({
          type: "audio_done",
          turn_id: j.turn,
          response_id: j.id,
          message_id: j.message.id,
        });
      });
    } catch (e) {
      const cancelled = j.abort.signal.aborted;
      j.abort.abort();
      j.tts?.close();
      await speech.catch(() => {});
      if (applied)
        await core("/stream/cancel", token, { turn_id: j.turn }).catch(
          () => {},
        );
      send({
        type: "response.cancelled",
        turn_id: j.turn,
        response_id: j.id,
        message_id: j.message?.id,
      });
      if (!cancelled) error(e);
    } finally {
      if (j.tts) {
        if (j.abort.signal.aborted || closed) j.tts.close();
        else speechConnection = j.tts;
      }
      j.tts = undefined;
      send({
        type: "result",
        view: await core("/session", token).catch(() => null),
        turn_id: j.turn,
        response_id: j.id,
      });
    }
  };
  const submit = async (turn: string, text: string) => {
    await core("/stream/input", token, { turn_id: turn, text });
    cancel();
    const j: Job = {
      id: randomUUID(),
      turn,
      abort: new AbortController(),
      text: "",
      played: false,
    };
    job = j;
    send({ type: "response.start", turn_id: turn, response_id: j.id });
    j.done = serial(token, () => process(j, text)).catch(error);
  };
  const createSTT = async () => {
    stt?.close();
    stt = new LiveTranscriber(
      (turn, text) => send({ type: "transcript.delta", turn_id: turn, text }),
      () => {
        if (!closed) {
          send({ type: "error", code: "transcription_unavailable" });
          ws.close(1011);
        }
      },
    );
    await stt.ready;
  };
  let ticks = 0;
  const timer = setInterval(() => {
    if (Date.now() - lastSeen > 30000) {
      ws.close(1001);
      return;
    }
    if (++ticks % 10 === 0) send({ type: "ping" });
    if (input && Date.now() - input.at > 90000) {
      error(new AppError("audio_too_long"));
      ws.close(1008);
    }
    if (token)
      void state().catch((e) => {
        cancel();
        if (e instanceof AppError && e.code === "human_active") {
          send({ type: "handoff" });
          ws.close(1000, "human_active");
        } else {
          error(e);
          ws.close(1011);
        }
      });
  }, 1000);
  const authTimer = setTimeout(() => ws.close(1008), 20000);
  const handle = async (raw: string) => {
    const e = JSON.parse(raw);
    if (!token) {
      if (e.type !== "auth") throw new AppError("unauthorized", 401);
      token = z.string().min(40).max(200).parse(e.token);
      const v = await core("/session", token);
      sessionId = v.session_id || "";
      caseId = v.case.id;
      // Session identifier is returned separately from case identity.
      if (!sessionId) sessionId = caseId;
      await core("/sessions/touch", token, {});
      await state();
      if (closed) return;
      release = reserve();
      await createSTT();
      if (closed) return;
      speechConnection = new RealtimeConnection({});
      await speechConnection.ready;
      clearTimeout(authTimer);
      send({ type: "ready", mode: "live" });
      const greeting = (await state()).messages
        .filter((m: any) => m.kind === "greeting")
        .at(-1);
      if (greeting && greeting.delivery !== "played") {
        const j: Job = {
          id: randomUUID(),
          turn: greeting.turn_id,
          abort: new AbortController(),
          text: greeting.text,
          message: greeting,
          played: false,
        };
        job = j;
        send({
          type: "response.start",
          turn_id: j.turn,
          response_id: j.id,
          message: greeting,
        });
        j.done = serial(token, async () => {
          try {
            await limited(() => speak(j, greeting.text));
            j.outputDone = !j.abort.signal.aborted;
            if (!j.abort.signal.aborted)
              send({
                type: "audio_done",
                turn_id: j.turn,
                response_id: j.id,
                message_id: greeting.id,
              });
          } catch (e) {
            if (!j.abort.signal.aborted) error(e);
          } finally {
            if (j.tts) {
              if (j.abort.signal.aborted || closed) j.tts.close();
              else speechConnection = j.tts;
            }
            j.tts = undefined;
          }
        });
      }
      return;
    }
    const event = liveInputSchema.parse(e);
    lastSeen = Date.now();
    if (event.type === "pong") {
      await core("/sessions/touch", token, {});
      return;
    }
    if (event.type === "cancel") {
      cancel();
      return;
    }
    if (event.type === "played") {
      const j = job;
      if (
        j &&
        j.id === event.response_id &&
        j.message?.id === event.message_id &&
        !j.abort.signal.aborted &&
        j.outputDone
      ) {
        await core("/stream/played", token, { message_id: event.message_id });
        j.played = true;
        send({ type: "listening" });
      }
      return;
    }
    if (event.type === "input_cancel") {
      input = null;
      await committing;
      await createSTT();
      send({ type: "input.ready" });
      return;
    }
    if (event.type === "speech_start") {
      cancel();
      await committing;
      await state();
      if (input || seen.has(event.turn_id))
        throw new AppError("invalid_state", 409);
      if (seen.size >= 1000) throw new AppError("session_limit", 429);
      rate("live-turn:" + token, 30);
      seen.add(event.turn_id);
      input = { id: event.turn_id, bytes: 0, at: Date.now() };
      stt!.begin(event.turn_id);
      send({ type: "speech.started", turn_id: event.turn_id });
      return;
    }
    if (event.type === "audio") {
      if (!input || input.id !== event.turn_id) return;
      input.bytes += Buffer.byteLength(event.audio, "base64");
      if (input.bytes > 24000 * 2 * 90)
        throw new AppError("audio_too_long", 413);
      stt!.append(event.audio);
      return;
    }
    if (event.type === "speech_end") {
      if (!input || input.id !== event.turn_id) return;
      const turn = input.id;
      input = null;
      send({ type: "transcribing", turn_id: turn });
      committing = stt!
        .commit()
        .then(async (text) => {
          send({ type: "transcript.final", turn_id: turn, text });
          if (text.trim()) await submit(turn, text);
          else send({ type: "listening" });
        })
        .catch((e) => {
          error(e);
          ws.close(1011);
        });
      return;
    }
    if (event.type === "text") {
      if (seen.has(event.turn_id)) return;
      rate("live-turn:" + token, 30);
      seen.add(event.turn_id);
      await state();
      input = null;
      await committing;
      await createSTT();
      send({ type: "input.ready" });
      send({
        type: "transcript.final",
        turn_id: event.turn_id,
        text: event.text,
      });
      await submit(event.turn_id, event.text);
      return;
    }
  };
  ws.on("message", (raw) => {
    if (++backlog > 1000) {
      ws.close(1008);
      return;
    }
    // Barge-in must not wait behind transcription finalization or provider calls.
    try {
      const e = JSON.parse(String(raw));
      if (token && ["speech_start", "text", "cancel"].includes(e.type))
        cancel();
    } catch {}
    commands = commands
      .then(() => handle(String(raw)))
      .catch((e) => {
        error(e);
        if (!sessionId || !stt) ws.close(1011);
      })
      .finally(() => backlog--);
  });
  ws.on("close", (code, reason) => {
    closed = true;
    clearInterval(timer);
    clearTimeout(authTimer);
    cancel();
    stt?.close();
    speechConnection?.close();
    release?.();
    if (
      token &&
      !(
        code === 1000 &&
        ["client_view_closed", "voice_disabled", "human_active"].includes(
          String(reason),
        )
      )
    )
      void core("/sessions/end", token, { reason: "connection_lost" }).catch(
        () => {},
      );
  });
}
