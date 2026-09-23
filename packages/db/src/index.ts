import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { seed } from "@voice/knowledge";
import {
  AppError,
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
 INSERT OR IGNORE INTO meta VALUES('schema_version','1');`);
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
  createSession(workspace = "demo") {
    this.seed(workspace);
    const now = new Date().toISOString(),
      id = randomUUID(),
      token = randomUUID() + randomUUID();
    const c: CaseState = {
      id: randomUUID(),
      workspace_id: workspace,
      client_id: null,
      status: "open",
      owner: null,
      language: "ru",
      active: null,
      queue: [],
      stack: [],
      slots: {},
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
    this.db
      .prepare("INSERT INTO cases VALUES(?,?,?,?,?,?,?)")
      .run(c.id, workspace, null, c.status, null, 0, JSON.stringify(c));
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?)")
      .run(id, c.id, workspace, hash(token), "active", null, now, Date.now());
    return { session_id: id, token, case_id: c.id };
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
  message(caseId: string, role: Message["role"], text: string, turnId: string) {
    const m: Message = {
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
    this.db
      .prepare("UPDATE sessions SET last_seen=?,status=? WHERE id=?")
      .run(Date.now(), "active", s.id);
    return s;
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
