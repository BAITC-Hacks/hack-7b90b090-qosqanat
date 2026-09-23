import { LiveVoiceClient } from "../../../apps/web/src/live-voice.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@voice/db";
import { SentenceBuffer, responseEvents } from "../../ai/src/streaming.js";
import { Engine } from "../src/index.js";
import { VoiceActivity } from "../../../apps/web/src/vad.js";
import type { Decision } from "@voice/contracts";
const decision: Decision = {
  scenarios: [{ scenario_id: "SC29", confidence: 1 }],
  slots: { contact_field: "email", new_value: "stream@example.com" },
  language: "ru",
  reply_language: "ru",
  alternatives: [],
  is_continuation: false,
  reason: "test",
  knowledge_topics: [],
};
function setup(path = ":memory:") {
  const s = new Store(path),
    e = new Engine(s),
    a = s.createSession("+77010000001");
  s.start(a.token);
  return { s, e, a };
}
test("streaming drafts are excluded from context; append is monotonic and finalization idempotent", () => {
  const { s, e, a } = setup(),
    turn = randomUUID();
  e.apply(a.token, "Изменить почту", turn, decision, 0, true);
  const m = e.streamReply(a.token, turn, "Новый адрес: ", "draft")!;
  assert.equal(
    e.context(a.token).messages.filter((m) => m.text.startsWith("Новый"))
      .length,
    0,
  );
  assert.throws(
    () => e.streamReply(a.token, turn, "Подмена текста", "draft"),
    /stale_state/,
  );
  e.streamReply(
    a.token,
    turn,
    "Новый адрес: s***@example.com. Подтверждаете?",
    "completed",
  );
  assert.equal(e.streamReply(a.token, turn, "дубликат", "completed")!.id, m.id);
  assert.equal(
    s
      .messages(a.case_id)
      .filter((m) => m.turn_id === turn && m.role === "assistant").length,
    1,
  );
  s.close();
});
test("unfinished preview never authorizes an operation; cancellation invalidates preview", () => {
  const { s, e, a } = setup(),
    turn = randomUUID();
  e.apply(a.token, "Изменить почту", turn, decision, 0, true);
  assert.equal(s.get(a.case_id).pending?.confirmation_ready, false);
  e.streamReply(a.token, turn, "Новый адрес", "draft");
  e.apply(a.token, "Да", randomUUID(), { ...decision, slots: {} }, 0, true);
  assert.equal(
    (s.db.prepare("SELECT count(*) n FROM operations").get() as any).n,
    0,
  );
  const latest = s.get(a.case_id).pending!.turn_id!;
  e.cancelStream(a.token, latest);
  assert.equal(s.get(a.case_id).pending, null);
  s.close();
});
test("completed and played preview can be confirmed once; late cancellation never reverts action", () => {
  const { s, e, a } = setup(),
    turn = randomUUID();
  e.apply(a.token, "Изменить почту", turn, decision, 0, true);
  const m = e.streamReply(
    a.token,
    turn,
    "Новый адрес. Подтверждаете?",
    "completed",
  )!;
  e.playedStream(a.token, m.id);
  assert.equal(s.get(a.case_id).pending?.confirmation_ready, true);
  const confirmation = randomUUID();
  e.apply(a.token, "Да", confirmation, { ...decision, slots: {} }, 0, true);
  e.apply(a.token, "Да", confirmation, decision, 0, true);
  e.cancelStream(a.token, turn);
  assert.equal(
    s.entities("clients").find((c) => c.client_id === "C001").email,
    "stream@example.com",
  );
  assert.equal(
    (s.db.prepare("SELECT count(*) n FROM operations").get() as any).n,
    1,
  );
  s.close();
});
test("interrupted answer persists; restart marks unfinished drafts; foreign turn cannot write", () => {
  const dir = mkdtempSync(join(tmpdir(), "stream-test-")),
    path = join(dir, "db.sqlite");
  const { s, e, a } = setup(path),
    turn = randomUUID();
  e.apply(a.token, "Изменить почту", turn, decision, 0, true);
  e.streamReply(a.token, turn, "Предложение", "draft");
  const b = s.createSession("+77010000002");
  s.start(b.token);
  assert.throws(
    () => e.streamReply(b.token, turn, "Чужой ответ", "completed"),
    /invalid_state/,
  );
  s.close();
  const restored = new Store(path);
  restored.recover();
  assert.equal(restored.messages(a.case_id).at(-1)!.status, "interrupted");
  assert.equal(restored.get(a.case_id).pending, null);
  restored.close();
  rmSync(dir, { recursive: true });
});
test("operator handoff blocks new streamed reply chunks", () => {
  const { s, e, a } = setup(),
    turn = randomUUID();
  e.apply(a.token, "Изменить почту", turn, decision, 0, true);
  e.streamReply(a.token, turn, "Предложение", "draft");
  e.claim(a.case_id, { id: "operator1", role: "operator", name: "One" });
  assert.equal(
    e.streamReply(a.token, turn, "Предложение изменено", "completed"),
    null,
  );
  s.close();
});
test("VAD keeps pre-roll, tolerates inner pauses and ends after 700ms; reset discards input", () => {
  const vad = new VoiceActivity(),
    silence = new Float32Array(480),
    speech = new Float32Array(480).fill(0.1);
  for (let i = 0; i < 15; i++) assert.equal(vad.push(silence).length, 0);
  vad.push(speech);
  vad.push(speech);
  const start = vad.push(speech);
  assert.equal(start[0]!.type, "start");
  assert.equal(start.filter((e) => e.type === "audio").length, 15);
  for (let i = 0; i < 20; i++)
    assert(!vad.push(silence).some((e) => e.type === "end"));
  for (let i = 0; i < 3; i++) vad.push(speech);
  for (let i = 0; i < 34; i++)
    assert(!vad.push(silence).some((e) => e.type === "end"));
  assert(vad.push(silence).some((e) => e.type === "end"));
  vad.reset();
  assert.equal(vad.active, false);
  for (let i = 0; i < 40; i++)
    assert.equal(vad.push(new Float32Array(480).fill(0.02), true).length, 0);
});
test("SSE parses split UTF8 and CRLF; sentence buffering preserves decimal and email", async () => {
  const encoded = new TextEncoder().encode(
    'data: {"delta":"Сәлем"}\r\n\r\ndata: [DONE]\r\n\r\n',
  );
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= encoded.length) c.close();
      else c.enqueue(encoded.slice(i, (i += 1)));
    },
  });
  const events = [];
  for await (const e of responseEvents(stream)) events.push(e);
  assert.deepEqual(events, [{ delta: "Сәлем" }]);
  const buffer = new SentenceBuffer();
  assert.deepEqual(buffer.append("Стоимость 3.5. Почта a@b."), [
    "Стоимость 3.5. ",
  ]);
  assert.deepEqual(buffer.append("com. Продолжим?"), ["Почта a@b.com. "]);
  assert.deepEqual(buffer.append("", true), ["Продолжим?"]);
});

test("final input persists before model work and repeated input cannot duplicate or replace it", () => {
  const { s, e, a } = setup();
  const turn = randomUUID();
  e.acceptInput(a.token, turn, "Где ваш офис?");
  e.acceptInput(a.token, turn, "Где ваш офис?");
  assert.equal(
    s
      .view(s.session(a.token).case_id)
      .messages.filter((m) => m.turn_id === turn && m.role === "client").length,
    1,
  );
  assert.throws(
    () => e.acceptInput(a.token, turn, "Подменённая реплика"),
    /stale_state/,
  );
});

test("VAD ends against calibrated background and ignores clicks during a pause", () => {
  const vad = new VoiceActivity();
  const frame = (amplitude: number) => new Float32Array(480).fill(amplitude);
  for (let i = 0; i < 30; i++) assert.equal(vad.push(frame(0.02)).length, 0);
  let starts = 0,
    ends = 0;
  for (let i = 0; i < 20; i++)
    starts += vad.push(frame(0.09)).filter((e) => e.type === "start").length;
  for (let i = 0; i < 35; i++)
    ends += vad
      .push(frame(i === 20 ? 0.1 : 0.02))
      .filter((e) => e.type === "end").length;
  assert.equal(starts, 1);
  assert.equal(ends, 1);
  for (let i = 0; i < 50; i++) assert.equal(vad.push(frame(0.02)).length, 0);
});
test("VAD accepts quiet speech and requires sustained barge-in", () => {
  const vad = new VoiceActivity();
  const frame = (n: number) => new Float32Array(480).fill(n);
  for (let i = 0; i < 15; i++) vad.push(frame(0.001));
  for (let i = 0; i < 2; i++) assert.equal(vad.push(frame(0.01)).length, 0);
  assert(vad.push(frame(0.01)).some((e) => e.type === "start"));
  for (let i = 0; i < 35; i++) vad.push(frame(0.001));
  for (let i = 0; i < 7; i++)
    assert.equal(vad.push(frame(0.08), true).length, 0);
  assert(vad.push(frame(0.08), true).some((e) => e.type === "start"));
});

test("VAD closes a turn after the background level rises", () => {
  const vad = new VoiceActivity();
  const frame = (n: number) => new Float32Array(480).fill(n);
  for (let i = 0; i < 20; i++) vad.push(frame(0.002));
  for (let i = 0; i < 50; i++) vad.push(frame(0.15));
  let ends = 0;
  for (let i = 0; i < 150; i++)
    ends += vad
      .push(frame([0.006, 0.014, 0.022, 0.012][i % 4]!))
      .filter((e) => e.type === "end").length;
  assert.equal(ends, 1);
});

test("muting finalizes the active utterance without removing its draft or duplicating end", () => {
  const events: any[] = [],
    sent: any[] = [];
  const client = new LiveVoiceClient("test", (e) => events.push(e));
  client.send = (e) => {
    sent.push(e);
  };
  Object.assign(client, { turn: "test-turn" });
  client.mute();
  assert.deepEqual(sent, [{ type: "speech_end", turn_id: "test-turn" }]);
  assert(!events.some((e) => e.type === "transcript.cancelled"));
  client.mute();
  assert.equal(sent.length, 1);
});
