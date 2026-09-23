import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Store } from "@voice/db";
import {
  phoneSchema,
  createSessionSchema,
  type Decision,
} from "@voice/contracts";
import { Engine } from "../src/index.js";
import { languageChoice } from "../src/language.js";
const d = (
  reply_language: "ru" | "kk" = "ru",
  slots: Decision["slots"] = {},
): Decision => ({
  scenarios: [{ scenario_id: "SC29", confidence: 1 }],
  alternatives: [],
  language: reply_language,
  reply_language,
  slots,
  is_continuation: false,
  reason: "test",
  knowledge_topics: [],
});
test("phone required, canonical normalization and one stable identity", async () => {
  for (const input of [
    "",
    "123",
    "+1 7010000001",
    "+770100000011",
    "+7abc7010000001",
  ])
    assert(!phoneSchema.safeParse(input).success);
  assert(!createSessionSchema.safeParse({}).success);
  const s = new Store(":memory:");
  const sessions = await Promise.all(
    ["+7 (701) 000-00-01", "77010000001", "8 701 000 00 01"].map(async (p) =>
      s.createSession(p),
    ),
  );
  assert(sessions.every((a) => a.phone === "+77010000001"));
  assert.equal(
    new Set(sessions.map((a) => s.get(a.case_id).client_id)).size,
    1,
  );
  assert.equal(
    s.entities("clients").filter((c) => c.phone === "+77010000001").length,
    1,
  );
  assert.throws(
    () => new Engine(s).apply(sessions[0]!.token, "да", randomUUID(), d()),
    /conversation_not_started/,
  );
  s.close();
});
test("history access scoped to client and workspace, no anonymous adoption", () => {
  const s = new Store(":memory:");
  const a = s.createSession("+77015550000");
  s.start(a.token);
  s.message(a.case_id, "client", "Моя история", randomUUID());
  const b = s.createSession("87015550000");
  const foreign = s.createSession("+77015550001");
  const other = s.createSession(a.phone, "ru", "other");
  assert.equal(s.customerHistory(b.token, a.case_id).messages.length, 2);
  assert.throws(() => s.customerHistory(foreign.token, a.case_id), /forbidden/);
  assert.throws(() => s.customerHistory(other.token, a.case_id), /forbidden/);
  const legacy = s.get(a.case_id);
  legacy.client_id = null;
  s.save(legacy);
  assert(!s.customerCases(b.token).some((c) => c.id === a.case_id));
  assert.throws(() => s.customerHistory(b.token, a.case_id), /forbidden/);
  s.close();
});
test("greetings once per start or reconnect; resume clears preview, closes old connection", () => {
  const s = new Store(":memory:");
  const e = new Engine(s);
  const a = s.createSession("+77010000001", "kk");
  assert.equal(s.messages(a.case_id).length, 0);
  s.start(a.token);
  s.start(a.token);
  s.touch(a.token);
  s.view(a.case_id);
  assert.equal(s.messages(a.case_id).length, 1);
  assert.match(s.messages(a.case_id)[0]!.text, /Сәлеметсіз/);
  e.apply(
    a.token,
    "Измените почту",
    randomUUID(),
    d("ru", { contact_field: "email", new_value: "test@example.com" }),
  );
  assert(s.get(a.case_id).pending);
  s.disconnect(a.token);
  s.touch(a.token);
  s.touch(a.token);
  assert.equal(
    s.messages(a.case_id).filter((m) => m.kind === "greeting").length,
    2,
  );
  assert.equal(s.get(a.case_id).pending, null);
  assert.equal(s.get(a.case_id).next_step, "confirm_again");
  const b = s.createSession(a.phone);
  e.resume(b.token, a.case_id);
  e.resume(b.token, a.case_id);
  assert.equal(
    s.messages(a.case_id).filter((m) => m.kind === "greeting").length,
    3,
  );
  assert.equal(s.session(a.token).status, "closed");
  assert.equal(s.session(b.token).status, "active");
  assert.equal(s.get(a.case_id).pending, null);
  s.close();
});
test("spoken foreign identity cannot switch owner, contact change retains old history", () => {
  const s = new Store(":memory:");
  const e = new Engine(s);
  const a = s.createSession("+77010000001");
  s.start(a.token);
  const id = s.get(a.case_id).client_id;
  e.apply(
    a.token,
    "Мой номер 87010000002",
    randomUUID(),
    d("ru", { phone: "+77010000002", iin: "999999999999" }),
  );
  assert.equal(s.get(a.case_id).client_id, id);
  assert.equal(s.get(a.case_id).slots.phone, a.phone);
  e.apply(
    a.token,
    "Измените контактный номер",
    randomUUID(),
    d("ru", { contact_field: "phone", new_value: "+77014445566" }),
  );
  assert.equal(
    s.entities("clients").find((c) => c.client_id === id).phone,
    a.phone,
  );
  e.apply(a.token, "Да", randomUUID(), d());
  const b = s.createSession("+77014445566");
  assert.equal(s.get(b.case_id).client_id, id);
  assert(s.customerCases(b.token).some((c) => c.id === a.case_id));
  const old = s.createSession(a.phone);
  assert.notEqual(s.get(old.case_id).client_id, id);
  s.close();
});
test("language last three meaningful turns, ties, short answers and explicit preference", () => {
  let result = languageChoice("Офис в Алматы", d(), "kk", []);
  assert.equal(result.language, "ru");
  result = languageChoice("Кеңсе қайда?", d("kk"), "ru", result.samples);
  assert.equal(result.language, "kk");
  result = languageChoice("Адрес офиса", d(), "kk", result.samples);
  assert.equal(result.language, "ru");
  result = languageChoice("77010000001", d("kk"), "ru", result.samples);
  assert.equal(result.language, "ru");
  assert.equal(result.samples.length, 3);
  assert.equal(
    languageChoice("Жеті жүз бір", d("kk"), "ru", result.samples).language,
    "ru",
  );
  assert.equal(
    languageChoice("Да, подтверждаю", d("kk"), "ru", result.samples).language,
    "ru",
  );
  result = languageChoice("Иә", d("kk"), "ru", result.samples);
  assert.equal(result.language, "ru");
  result = languageChoice("Говорите по-казахски", d(), "ru", result.samples);
  assert.equal(result.language, "kk");
  assert.equal(result.preference, "kk");
  result = languageChoice(
    "Адрес офиса",
    d(),
    "kk",
    result.samples,
    result.preference,
  );
  assert.equal(result.language, "kk");
  result = languageChoice(
    "Отвечайте по-русски",
    d("kk"),
    "kk",
    result.samples,
    result.preference,
  );
  assert.equal(result.language, "ru");
  const mixed = { ...d("kk"), language: "mixed" as const };
  assert.equal(
    languageChoice("Сәлем, как получить полис?", mixed, "ru", []).language,
    "kk",
  );
});
test("language preference persists into next call independently of UI locale", () => {
  const s = new Store(":memory:");
  const e = new Engine(s);
  const a = s.createSession("+77016669999", "en");
  s.start(a.token);
  assert.match(s.messages(a.case_id)[0]!.text, /Здравствуйте/);
  const result = e.apply(a.token, "Қазақша сөйлеңіз", randomUUID(), d());
  assert.equal(result.plan.language, "kk");
  const b = s.createSession(a.phone, "ru");
  s.start(b.token);
  assert.match(s.messages(b.case_id)[0]!.text, /Сәлеметсіз/);
  s.close();
});

test("completed operation is not repeated when a new session resumes", () => {
  const s = new Store(":memory:"),
    e = new Engine(s),
    a = s.createSession("+77010000001");
  s.start(a.token);
  e.apply(
    a.token,
    "Измените почту",
    randomUUID(),
    d("ru", { contact_field: "email", new_value: "once@example.com" }),
  );
  e.apply(a.token, "Да", randomUUID(), d());
  s.disconnect(a.token);
  const b = s.createSession(a.phone);
  e.resume(b.token, a.case_id);
  assert.equal(s.get(a.case_id).pending, null);
  assert.equal(
    (s.db.prepare("SELECT count(*) n FROM operations").get() as any).n,
    1,
  );
  s.close();
});
