import "../../scripts/env.js";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const base = "http://localhost:3000/api";
async function request(path: string, body?: unknown, token?: string) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert(r.ok, `${path}: ${r.status}`);
  return (await r.json()) as any;
}
const a = await request("/sessions", { phone: "+77010000001" });
await request("/start", {}, a.token);
const first = randomUUID(),
  second = randomUUID(),
  handoff = randomUUID();
let firstResponse = "",
  staleAudio = 0,
  cancelSeen = false;
await new Promise<void>((resolve, reject) => {
  const ws = new WebSocket("ws://localhost:3000/api/live", {
    headers: { Origin: "http://localhost:3000" },
  });
  let phase = "greeting";
  const timer = setTimeout(() => finish(Error("timeout")), 100000);
  function send(e: unknown) {
    ws.send(JSON.stringify(e));
  }
  function finish(e?: Error) {
    clearTimeout(timer);
    ws.close(1000, "client_view_closed");
    e ? reject(e) : resolve();
  }
  ws.on("open", () => send({ type: "auth", token: a.token }));
  ws.on("error", finish);
  ws.on("message", (raw) => {
    void (async () => {
      const e = JSON.parse(String(raw));
      if (e.type === "ping") send({ type: "pong" });
      if (
        e.type === "error" &&
        !["human_active", "session_closed"].includes(e.code)
      )
        return finish(Error(e.code));
      if (e.type === "response.start" && e.turn_id === first)
        firstResponse = e.response_id;
      if (e.type === "response.cancelled" && e.response_id === firstResponse)
        cancelSeen = true;
      if (cancelSeen && e.type === "audio" && e.response_id === firstResponse)
        staleAudio++;
      if (e.type === "audio_done" && phase === "greeting") {
        phase = "preview";
        send({
          type: "played",
          message_id: e.message_id,
          response_id: e.response_id,
        });
        send({
          type: "text",
          turn_id: first,
          text: "Измените мой email на live-interrupt@example.com",
        });
        return;
      }
      if (
        e.type === "audio" &&
        phase === "preview" &&
        e.response_id === firstResponse
      ) {
        phase = "interrupted";
        send({ type: "cancel" });
        send({ type: "text", turn_id: second, text: "Где офис в Алматы?" });
        send({ type: "text", turn_id: second, text: "Где офис в Алматы?" });
        return;
      }
      if (e.type === "audio_done" && phase === "interrupted") {
        send({
          type: "played",
          message_id: e.message_id,
          response_id: e.response_id,
        });
        const v = await request("/session", undefined, a.token);
        assert.equal(
          v.messages.filter(
            (m: any) => m.role === "client" && m.turn_id === first,
          ).length,
          1,
        );
        assert.equal(
          v.messages.filter(
            (m: any) => m.role === "client" && m.turn_id === second,
          ).length,
          1,
        );
        assert.equal(
          v.messages.find(
            (m: any) => m.role === "assistant" && m.turn_id === first,
          )?.status,
          "interrupted",
        );
        assert.equal(v.case.pending, null);
        assert(!v.actions.some((x: any) => x.mode === "execute"));
        assert.equal(staleAudio, 0);
        phase = "handoff";
        send({
          type: "text",
          turn_id: handoff,
          text: "Соедините с оператором",
        });
        return;
      }
      if (e.type === "handoff") {
        assert.equal(phase, "handoff");
        const v = await request("/session", undefined, a.token);
        assert.equal(v.case.status, "waiting_operator");
        finish();
      }
    })().catch((e) => finish(e));
  });
});
console.log(
  "PASS: keyboard text spoken in live mode; barge-in stops old audio; partial answer persisted; preview cancelled; repeated turn deduplicated; operator handoff stops AI",
);
