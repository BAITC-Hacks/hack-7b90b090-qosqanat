import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { seed } from "@voice/knowledge";
import { scenarioName } from "@voice/i18n";
import {
  AppError,
  phoneSchema,
  type CaseState,
  type CaseView,
  type Session,
  type Message,
  type Trace,
  type ActionEvent,
} from "@voice/contracts";
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY, workspace TEXT NOT NULL, client TEXT, status TEXT NOT NULL, owner TEXT, version INTEGER NOT NULL, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), workspace TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, status TEXT NOT NULL, ended_reason TEXT, created_at TEXT NOT NULL,last_seen INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS traces(id INTEGER PRIMARY KEY,case_id TEXT NOT NULL REFERENCES cases(id),data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS operations(key TEXT PRIMARY KEY,case_id TEXT NOT NULL,action TEXT NOT NULL,result TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS turns(key TEXT PRIMARY KEY,case_id TEXT NOT NULL,result TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS entities(workspace TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(workspace,kind,id));
 CREATE TABLE IF NOT EXISTS staff_sessions(token_hash TEXT PRIMARY KEY,staff_id TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS cases_client ON cases(workspace,client);
 CREATE INDEX IF NOT EXISTS messages_case ON messages(case_id);
 INSERT OR IGNORE INTO meta VALUES('schema_version','1');
 CREATE UNIQUE INDEX IF NOT EXISTS clients_phone ON entities(workspace,json_extract(data,'$.phone')) WHERE kind='clients' AND json_extract(data,'$.phone') IS NOT NULL;
 UPDATE meta SET value='2' WHERE key='schema_version';`);
  }
  transaction<T>(f: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = f();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  seed(workspace = "demo") {
    for (const kind of ["clients", "policies", "claims", "payments"])
      for (const x of seed[kind]) {
        const id =
          x.client_id && kind === "clients"
            ? x.client_id
            : x.policy_number && kind === "policies"
              ? x.policy_number
              : x.claim_number && kind === "claims"
                ? x.claim_number
                : x.payment_id;
        this.db
          .prepare("INSERT OR IGNORE INTO entities VALUES(?,?,?,?)")
          .run(workspace, kind, id, JSON.stringify(x));
      }
  }
  entities(kind: string, w = "demo"): any[] {
    return this.db
      .prepare("SELECT data FROM entities WHERE workspace=? AND kind=?")
      .all(w, kind)
      .map((r: any) => JSON.parse(r.data));
  }
  put(kind: string, id: string, data: unknown, w = "demo") {
    this.db
      .prepare(
        "INSERT INTO entities VALUES(?,?,?,?) ON CONFLICT(workspace,kind,id) DO UPDATE SET data=excluded.data",
      )
      .run(w, kind, id, JSON.stringify(data));
  }
  createSession(
    rawPhone: string,
    locale: "ru" | "kk" | "en" = "ru",
    workspace = "demo",
  ) {
    const phone = phoneSchema.parse(rawPhone);
    return this.transaction(() => {
      this.seed(workspace);
      let client = this.entities("clients", workspace).find(
        (x) => x.phone === phone,
      );
      if (!client) {
        client = {
          client_id: "C-" + randomUUID(),
          phone,
          full_name: "Demo client",
        };
        this.put("clients", client.client_id, client, workspace);
      }
      const now = new Date().toISOString(),
        id = randomUUID(),
        token = randomUUID() + randomUUID();
      const language =
        client.language_preference ||
        client.conversation_language ||
        this.list(workspace).find(
          (c) =>
            c.client_id === client.client_id && this.messages(c.id).length > 0,
        )?.language ||
        (locale === "kk" ? "kk" : "ru");
      const c: CaseState = {
        id: randomUUID(),
        workspace_id: workspace,
        client_id: client.client_id,
        status: "open",
        owner: null,
        language,
        active: null,
        queue: [],
        stack: [],
        slots: {
          phone,
          ...(client.city ? { city: String(client.city).toLowerCase() } : {}),
        },
        pending: null,
        next_step: "describe_request",
        summary: "",
        version: 0,
        low_confidence: 0,
        resume_candidates: [],
        created_at: now,
        updated_at: now,
        disconnect_reason: null,
      };
      c.resume_candidates = this.list(workspace)
        .filter(
          (x) =>
            x.client_id === client.client_id &&
            x.status !== "resolved" &&
            this.messages(x.id).length > 0,
        )
        .map((x) => x.id);
      this.db
        .prepare("INSERT INTO cases VALUES(?,?,?,?,?,?,?)")
        .run(
          c.id,
          workspace,
          c.client_id,
          c.status,
          null,
          0,
          JSON.stringify(c),
        );
      this.db
        .prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?)")
        .run(
          id,
          c.id,
          workspace,
          hash(token),
          "pending",
          null,
          now,
          Date.now(),
        );
      return { session_id: id, token, case_id: c.id, phone };
    });
  }
  customerCases(token: string) {
    const s = this.session(token),
      c = this.get(s.case_id);
    if (!c.client_id) throw new AppError("phone_required", 409);
    return this.list(c.workspace_id)
      .filter(
        (x) =>
          x.client_id === c.client_id &&
          x.id !== c.id &&
          this.messages(x.id).length > 0,
      )
      .map((x) => ({
        id: x.id,
        status: x.status,
        active:
          x.active ||
          this.traces(x.id).at(-1)?.scenarios[0]?.scenario_id ||
          null,
        created_at: x.created_at,
        updated_at: x.updated_at,
        next_step: x.next_step,
      }));
  }
  customerHistory(token: string, id: string) {
    const s = this.session(token),
      c = this.get(s.case_id),
      target = this.get(id);
    if (
      !c.client_id ||
      target.client_id !== c.client_id ||
      target.workspace_id !== c.workspace_id
    )
      throw new AppError("forbidden", 403);
    return { case_id: id, messages: this.messages(id) };
  }
  greet(session: Session, restored = false) {
    const c = this.get(session.case_id);
    const last = this.messages(c.id).at(-1);
    if (
      !restored &&
      last?.kind === "greeting" &&
      last.session_id === session.id
    )
      return last;
    const id = c.active || this.traces(c.id).at(-1)?.scenarios[0]?.scenario_id;
    const subject = id ? scenarioName(id, c.language) : null;
    const text =
      c.owner || c.status === "waiting_operator"
        ? c.language === "kk"
          ? "Сәлеметсіз бе! Өтінішіңіз операторда, әңгіме тарихы сақталған."
          : "Здравствуйте! Ваше обращение у оператора, история разговора сохранена."
        : restored
          ? c.language === "kk"
            ? subject
              ? `Сәлеметсіз бе! Өткенде «${subject}» тақырыбын талқыладық. Жалғастырайық па?`
              : "Сәлеметсіз бе! Әңгімемізді жалғастырайық па?"
            : subject
              ? `Здравствуйте! В прошлый раз мы обсуждали «${subject}». Продолжим?`
              : "Здравствуйте! Продолжим наш разговор?"
          : c.language === "kk"
            ? "Сәлеметсіз бе! Бұл Saqta сақтандыру көмекшісі. Сізге қалай көмектесе аламын?"
            : "Здравствуйте! Это страховой помощник Saqta. Чем могу помочь?";
    return this.message(c.id, "assistant", text, randomUUID(), {
      kind: "greeting",
      session_id: session.id,
    });
  }
  start(token: string) {
    return this.transaction(() => {
      const s = this.session(token),
        c = this.get(s.case_id);
      if (!c.client_id) throw new AppError("phone_required", 409);
      if (s.status === "closed") throw new AppError("session_closed", 409);
      if (s.status === "pending" || s.status === "disconnected") {
        if (c.pending || c.next_step.startsWith("confirm:"))
          c.next_step = "confirm_again";
        c.pending = null;
        c.resume_candidates = [];
        this.save(c);
        this.greet(s, s.status === "disconnected");
        this.db
          .prepare(
            "UPDATE sessions SET status='active',last_seen=?,ended_reason=NULL WHERE id=?",
          )
          .run(Date.now(), s.id);
      }
      return this.view(s.case_id);
    });
  }
  session(token: string): Session {
    const s = this.db
      .prepare("SELECT * FROM sessions WHERE token_hash=?")
      .get(hash(token)) as any;
    if (!s) throw new AppError("unauthorized", 401);
    return {
      id: s.id,
      case_id: s.case_id,
      workspace_id: s.workspace,
      token_hash: s.token_hash,
      status: s.status,
      ended_reason: s.ended_reason,
      created_at: s.created_at,
      last_seen: s.last_seen,
    };
  }
  get(id: string): CaseState {
    const row = this.db
      .prepare("SELECT data FROM cases WHERE id=?")
      .get(id) as any;
    if (!row) throw new AppError("not_found", 404);
    return JSON.parse(row.data);
  }
  save(c: CaseState) {
    const previous = c.version;
    c.version++;
    c.updated_at = new Date().toISOString();
    const r = this.db
      .prepare(
        "UPDATE cases SET client=?,status=?,owner=?,version=?,data=? WHERE id=? AND version=?",
      )
      .run(
        c.client_id,
        c.status,
        c.owner,
        c.version,
        JSON.stringify(c),
        c.id,
        previous,
      );
    if (!r.changes) throw new AppError("stale_state", 409);
  }
  list(workspace = "demo") {
    return this.db
      .prepare("SELECT data FROM cases WHERE workspace=? ORDER BY rowid DESC")
      .all(workspace)
      .map((r: any) => JSON.parse(r.data) as CaseState);
  }
  message(
    caseId: string,
    role: Message["role"],
    text: string,
    turnId: string,
    extra: Pick<Message, "kind" | "session_id"> = {},
  ) {
    const m: Message = {
      ...extra,
      id: randomUUID(),
      role,
      text,
      at: new Date().toISOString(),
      turn_id: turnId,
      delivery: role === "client" ? "displayed" : "unknown",
    };
    this.db
      .prepare("INSERT INTO messages VALUES(?,?,?)")
      .run(m.id, caseId, JSON.stringify(m));
    return m;
  }
  updateMessage(caseId: string, message: Message) {
    const result = this.db
      .prepare("UPDATE messages SET data=? WHERE id=? AND case_id=?")
      .run(JSON.stringify(message), message.id, caseId);
    if (!result.changes) throw new AppError("not_found", 404);
    return message;
  }
  messages(id: string): Message[] {
    return this.db
      .prepare("SELECT data FROM messages WHERE case_id=? ORDER BY rowid")
      .all(id)
      .map((r: any) => JSON.parse(r.data));
  }
  trace(id: string, t: Trace) {
    this.db
      .prepare("INSERT INTO traces(case_id,data) VALUES(?,?)")
      .run(id, JSON.stringify(t));
  }
  traces(id: string): Trace[] {
    return this.db
      .prepare("SELECT data FROM traces WHERE case_id=? ORDER BY id")
      .all(id)
      .map((r: any) => JSON.parse(r.data));
  }
  view(id: string): CaseView {
    const traces = this.traces(id);
    return {
      case: this.get(id),
      messages: this.messages(id),
      traces,
      actions: traces.flatMap((t) => t.actions),
    };
  }
  operation(key: string) {
    const r = this.db
      .prepare("SELECT result FROM operations WHERE key=?")
      .get(key) as any;
    return r ? JSON.parse(r.result) : null;
  }
  recordOperation(key: string, id: string, action: string, result: unknown) {
    this.db
      .prepare("INSERT INTO operations VALUES(?,?,?,?)")
      .run(key, id, action, JSON.stringify(result));
  }
  turn(key: string) {
    const r = this.db
      .prepare("SELECT result FROM turns WHERE key=?")
      .get(key) as any;
    return r ? JSON.parse(r.result) : null;
  }
  recordTurn(key: string, id: string, result: unknown) {
    this.db
      .prepare("INSERT INTO turns VALUES(?,?,?)")
      .run(key, id, JSON.stringify(result));
  }
  touch(token: string) {
    const s = this.session(token);
    if (s.status === "closed") throw new AppError("session_closed", 409);
    if (s.status === "disconnected") this.start(token);
    else
      this.db
        .prepare("UPDATE sessions SET last_seen=? WHERE id=?")
        .run(Date.now(), s.id);
    return this.session(token);
  }
  disconnect(token: string, reason = "connection_lost") {
    const s = this.session(token);
    if (s.status === "closed") return;
    this.transaction(() => {
      this.db
        .prepare("UPDATE sessions SET status=?,ended_reason=? WHERE id=?")
        .run(
          reason === "client_ended" ? "closed" : "disconnected",
          reason,
          s.id,
        );
      const c = this.get(s.case_id);
      if (c.pending || c.next_step.startsWith("confirm:"))
        c.next_step = "confirm_again";
      c.pending = null;
      c.disconnect_reason = reason;
      if (c.status === "open") c.status = "waiting_customer";
      if (
        reason === "client_ended" &&
        c.next_step === "completed" &&
        !c.active &&
        !c.queue.length &&
        !c.stack.length
      )
        c.status = "resolved";
      this.save(c);
    });
  }
  recover() {
    for (const row of this.db
      .prepare(
        "SELECT id,case_id,data FROM messages WHERE json_extract(data,'$.status')='draft'",
      )
      .all() as any[]) {
      const m = JSON.parse(row.data);
      m.status = "interrupted";
      m.delivery = "interrupted";
      this.updateMessage(row.case_id, m);
    }

    const rows = this.db
      .prepare("SELECT id,case_id FROM sessions WHERE status='active'")
      .all() as any[];
    this.transaction(() => {
      for (const s of rows) {
        this.db
          .prepare(
            "UPDATE sessions SET status='disconnected',ended_reason='server_restart' WHERE id=?",
          )
          .run(s.id);
        const c = this.get(s.case_id);
        if (c.pending || c.next_step.startsWith("confirm:"))
          c.next_step = "confirm_again";
        c.pending = null;
        c.disconnect_reason = "server_restart";
        if (c.status === "open") c.status = "waiting_customer";
        this.save(c);
      }
    });
  }
  delivery(caseId: string, id: string, delivery: Message["delivery"]) {
    const r = this.db
      .prepare("SELECT data FROM messages WHERE id=? AND case_id=?")
      .get(id, caseId) as any;
    if (!r) throw new AppError("not_found", 404);
    const m = JSON.parse(r.data);
    m.delivery = delivery;
    this.db
      .prepare("UPDATE messages SET data=? WHERE id=?")
      .run(JSON.stringify(m), id);
  }
  close() {
    this.db.close();
  }
}
