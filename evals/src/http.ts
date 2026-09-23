import "../../scripts/env.js";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { root } from "@voice/knowledge";
const base = "http://localhost:3000/api";
async function request(
  path: string,
  body?: unknown,
  token?: string,
  cookie?: string,
) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: r.status,
    data: (await r.json()) as any,
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
const clients = await Promise.all(
  Array.from({ length: 3 }, (_, i) =>
    request("/sessions", { phone: "+7701888000" + i }),
  ),
);
for (const c of clients) {
  assert.equal(c.status, 200);
  assert.equal((await request("/start", {}, c.data.token)).status, 200);
}
const hearts = setInterval(() => {
  for (const c of clients) void request("/heartbeat", {}, c.data.token);
}, 5000);
try {
  const texts = [
    "Где ваш офис в Алматы?",
    "Астанада кеңсеңіз қайда?",
    "Скажите адрес офиса в Шымкенте",
  ];
  const turns = await Promise.all(
    clients.map((c, i) =>
      request("/turn", { text: texts[i], turn_id: randomUUID() }, c.data.token),
    ),
  );
  for (let i = 0; i < 3; i++) {
    assert.equal(turns[i]!.status, 200);
    const v = turns[i]!.data.view;
    assert.equal(v.messages.filter((m: any) => m.role === "client").length, 1);
    assert.equal(
      v.messages.find((m: any) => m.role === "client").text,
      texts[i],
    );
    assert.equal(v.traces[0].scenarios[0].scenario_id, "SC33");
  }
  assert.equal(
    (
      await request(
        "/session",
        undefined,
        "not-a-valid-token-but-long-enough-to-pass-schema",
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request(
        "/turn",
        {
          text: "test",
          turn_id: randomUUID(),
          confirmed: true,
          role: "supervisor",
        },
        clients[0]!.data.token,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/resume",
        { case_id: clients[1]!.data.case_id },
        clients[0]!.data.token,
      )
    ).status,
    403,
  );
  assert.equal((await request("/staff/cases")).status, 401);
  const password =
    process.env.STAFF_PASSWORD ||
    JSON.parse(readFileSync(root + "/var/local-config.json", "utf8"))
      .STAFF_PASSWORD;
  const one = await request("/staff/login", { id: "operator1", password }),
    two = await request("/staff/login", { id: "operator2", password });
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  const id = clients[0]!.data.case_id;
  const claims = await Promise.all([
    request("/staff/cases/" + id + "/claim", {}, undefined, one.cookie),
    request("/staff/cases/" + id + "/claim", {}, undefined, two.cookie),
  ]);
  assert.deepEqual(claims.map((x) => x.status).sort(), [200, 409]);
  const owner = claims[0]!.status === 200 ? one : two,
    other = owner === one ? two : one,
    target = owner === one ? "operator2" : "operator1";
  assert.equal(
    (
      await request(
        "/staff/cases/" + id + "/transfer",
        { target },
        undefined,
        owner.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/staff/cases/" + id + "/reply",
        { text: "wrong owner" },
        undefined,
        owner.cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/staff/cases/" + id + "/reply",
        { text: "Продолжим с сохранённого вопроса" },
        undefined,
        other.cookie,
      )
    ).status,
    200,
  );
  const later = await request(
    "/turn",
    { text: "Можно продолжить?", turn_id: randomUUID() },
    clients[0]!.data.token,
  );
  assert.equal(later.status, 200);
  assert.equal(later.data.message, null);
  assert(later.data.view.messages.some((x: any) => x.role === "operator"));
  console.log(
    "PASS: 3 parallel live model sessions, isolated histories, strict payloads, foreign resume rejection, staff access, atomic claim, transfer and AI stop",
  );
} finally {
  clearInterval(hearts);
  for (const c of clients) await request("/end", {}, c.data.token);
}
