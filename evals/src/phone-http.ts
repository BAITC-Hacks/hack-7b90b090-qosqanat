import assert from "node:assert/strict";
import WebSocket from "ws";
const base = "http://localhost:3000/api";
async function req(path: string, body?: unknown, token?: string) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, data: (await r.json()) as any };
}
assert.equal((await req("/sessions", {})).status, 400);
assert.equal(
  (await req("/sessions", { phone: "123" })).data.error.code,
  "invalid_phone",
);
const number = "7701" + String(Date.now()).slice(-7);
const phones = [
  "+" + number,
  number,
  "8 (" +
    number.slice(1, 4) +
    ") " +
    number.slice(4, 7) +
    "-" +
    number.slice(7),
];
const results = await Promise.all(
  phones.map((phone) => req("/sessions", { phone })),
);
results.forEach((r) => assert.equal(r.status, 200));
const [a, b, c] = results.map((r) => r.data);
const states = await Promise.all(
  results.map((r) => req("/session", undefined, r.data.token)),
);
assert.equal(new Set(states.map((r) => r.data.case.client_id)).size, 1);
assert(
  states.every(
    (r) => r.data.messages.length === 0 && r.data.session_status === "pending",
  ),
);
await req("/start", {}, a.token);
await req("/start", {}, a.token);
assert.equal(
  (await req("/session", undefined, a.token)).data.messages.length,
  1,
);
const history = (await req("/customer/cases", undefined, b.token)).data;
assert(history.some((x: any) => x.id === a.case_id));
assert.equal(
  (await req("/customer/cases/" + a.case_id, undefined, b.token)).status,
  200,
);
const foreign = (await req("/sessions", { phone: "+77013332211" })).data;
assert.equal(
  (await req("/customer/cases/" + a.case_id, undefined, foreign.token)).status,
  403,
);
assert.equal((await req("/customer/cases/" + a.case_id)).status, 401);
await req("/resume", { case_id: a.case_id }, b.token);
assert.equal(
  (await req("/session", undefined, a.token)).data.session_status,
  "closed",
);
assert.equal(
  (await req("/session", undefined, b.token)).data.messages.length,
  2,
);
async function connection(closeNormally: boolean) {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket("ws://localhost:3000/api/voice", {
      headers: { Origin: "http://localhost:3000" },
    });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(Error("timeout"));
    }, 10000);
    ws.on("open", () =>
      ws.send(JSON.stringify({ type: "auth", token: b.token })),
    );
    ws.on("message", (data) => {
      const e = JSON.parse(String(data));
      if (e.type === "ready") {
        if (closeNormally) ws.close(1000, "client_view_closed");
        else ws.terminate();
      }
      if (e.type === "error") reject(Error(e.code));
    });
    ws.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on("error", reject);
  });
}
await connection(true);
await req("/heartbeat", {}, b.token);
assert.equal(
  (await req("/session", undefined, b.token)).data.messages.length,
  2,
);
await connection(false);
// Wait for asynchronous close persistence, not for a heartbeat timeout.
for (let i = 0; i < 30; i++) {
  if (
    (await req("/session", undefined, b.token)).data.session_status ===
    "disconnected"
  )
    break;
  await new Promise((r) => setTimeout(r, 50));
}
assert.equal(
  (await req("/session", undefined, b.token)).data.session_status,
  "disconnected",
);
await req("/heartbeat", {}, b.token);
await req("/heartbeat", {}, b.token);
assert.equal(
  (await req("/session", undefined, b.token)).data.messages.length,
  3,
);
await req("/end", {}, b.token);
await req("/start", {}, c.token);
assert.equal(
  (await req("/session", undefined, c.token)).data.messages.length,
  1,
);
for (const token of [c.token, foreign.token]) await req("/end", {}, token);
console.log(
  "PASS: required phone; parallel normalized identity; authorized history; resume; ordinary page detach; real disconnect and exactly one recovery greeting",
);
