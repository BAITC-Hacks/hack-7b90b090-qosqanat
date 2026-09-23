import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowUp,
  Mic,
  Square,
  PhoneOff,
  ShieldCheck,
  History,
  Headphones,
  Globe2,
  LogOut,
  ChevronRight,
  Activity,
  ArrowLeft,
  Check,
  Radio,
  RefreshCw,
  LockKeyhole,
  MessageSquare,
  Search,
  Volume2,
  X,
} from "lucide-react";
import {
  initialLocale,
  t,
  scenarioName,
  scenarioDescription,
  formatDate,
  errorText as localizedError,
  type Locale,
} from "@voice/i18n";
import type { CaseView, CaseState, Staff } from "@voice/contracts";
import { VoiceClient } from "./voice";
import "./style.css";
type Auth = { session_id: string; token: string; case_id: string };
function App() {
  const [locale, setLocale] = useState<Locale>(initialLocale),
    [page, setPage] = useState(
      location.pathname.startsWith("/staff") ? "staff" : "client",
    ),
    [auth, setAuth] = useState<Auth | null>(() => {
      try {
        return JSON.parse(sessionStorage.getItem("voice-session") || "null");
      } catch {
        return null;
      }
    }),
    [view, setView] = useState<CaseView | null>(null),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [voiceState, setVoiceState] = useState("ready"),
    [ended, setEnded] = useState(false),
    [showTrace, setShowTrace] = useState(true),
    [staff, setStaff] = useState<Staff | null>(null),
    [account, setAccount] = useState("operator1"),
    [password, setPassword] = useState(""),
    [cases, setCases] = useState<CaseState[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [target, setTarget] = useState("operator2");
  const voice = useRef<VoiceClient | null>(null),
    messagesEnd = useRef<HTMLDivElement>(null);
  const tr = (key: string) => t(locale, key);
  const errorText = (code: string) => localizedError(code, locale);
  async function api(path: string, body?: unknown, token = auth?.token) {
    const r = await fetch("/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.code || "error");
    return d;
  }
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : "error");
  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem("locale", locale);
  }, [locale]);
  useEffect(() => {
    if (page === "staff")
      void api("/staff/me")
        .then(setStaff)
        .catch(() => {});
    else if (auth && !ended) void api("/session").then(setView).catch(fail);
  }, [page, auth?.token]);
  useEffect(() => {
    if (!auth || ended || page !== "client") return;
    const id = setInterval(() => {
      void api("/heartbeat", {})
        .then(() =>
          setVoiceState((state) =>
            state === "disconnected" ? "ready" : state,
          ),
        )
        .catch(() => setVoiceState("disconnected"));
      void api("/session")
        .then(setView)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [auth?.token, ended, page]);
  useEffect(() => {
    if (!staff || page !== "staff") return;
    const refresh = () => {
      void api("/staff/cases").then(setCases).catch(fail);
      if (selected)
        void api("/staff/cases/" + selected)
          .then(setView)
          .catch(fail);
    };
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [staff, page, selected]);
  useEffect(() => {
    (() => {
      const el = messagesEnd.current?.parentElement;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    })();
  }, [view?.messages.length]);
  useEffect(() => () => voice.current?.close(), []);
  function navigate(p: string) {
    voice.current?.close();
    voice.current = null;
    setPage(p);
    setView(null);
    setError("");
    history.pushState({}, "", p === "staff" ? "/staff" : "/");
  }
  async function begin() {
    setBusy(true);
    setError("");
    try {
      voice.current?.close();
      voice.current = null;
      const a = await api("/sessions", {}, undefined);
      sessionStorage.setItem("voice-session", JSON.stringify(a));
      setAuth(a);
      setEnded(false);
      setView(await api("/session", undefined, a.token));
      setVoiceState("ready");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (!input.trim() || busy) return;
    const text = input;
    setInput("");
    setBusy(true);
    setError("");
    voice.current?.cancel();
    try {
      if (page === "staff") {
        await api("/staff/cases/" + selected + "/reply", { text });
        setView(await api("/staff/cases/" + selected));
      } else {
        const result = await api("/turn", {
          text,
          turn_id: crypto.randomUUID(),
        });
        setView(result.view);
        if (result.message)
          void api("/delivery", {
            message_id: result.message.id,
            status: "displayed",
          }).catch(() => {});
      }
    } catch (e) {
      setInput(text);
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function end() {
    voice.current?.close();
    voice.current = null;
    try {
      await api("/end", {});
      setView(await api("/session"));
    } catch (e) {
      fail(e);
    }
    setEnded(true);
    setVoiceState("ready");
  }
  async function startVoice() {
    setError("");
    try {
      if (!auth) return;
      if (!voice.current)
        voice.current = new VoiceClient(
          auth.token,
          (e) => {
            if (e.type === "recording") {
              setVoiceState("listening");
              void voice.current?.capture().catch(fail);
            }
            if (e.type === "processing") setVoiceState("processing");
            if (e.type === "ready") setVoiceState("ready");
            if (e.type === "result") setView(e.view);
            if (e.type === "disconnected") setVoiceState("disconnected");
            if (e.type === "error") {
              setError(e.code);
              setVoiceState("ready");
            }
          },
          (id, status, total) => {
            void api(
              "/delivery",
              {
                message_id: id,
                status,
                ...(total === undefined ? {} : { total_ms: total }),
              },
              auth.token,
            ).catch(() => {});
          },
        );
      setVoiceState("connecting");
      await voice.current.start();
    } catch (e) {
      setVoiceState("ready");
      setError(
        e instanceof DOMException
          ? "voiceUnavailable"
          : e instanceof Error
            ? e.message
            : "error",
      );
    }
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setStaff(await api("/staff/login", { id: account, password }));
      setPassword("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function staffAction(action: string, body = {}) {
    setError("");
    try {
      await api("/staff/cases/" + selected + "/" + action, body);
      setView(await api("/staff/cases/" + selected));
      setCases(await api("/staff/cases"));
    } catch (e) {
      fail(e);
    }
  }
  const nextLabel = (value: string) => {
    const [key, detail] = value.split(":");
    return (
      tr(key!) +
      (detail
        ? " · " +
          (detail.startsWith("SC") ? scenarioName(detail, locale) : tr(detail))
        : "")
    );
  };
  const latest = view?.traces.at(-1);
  const visibleCases = cases.filter(
    (c) =>
      (filter !== "mine" || c.owner === staff?.id) &&
      (filter !== "unassigned" || !c.owner) &&
      (filter !== "interrupted" || !!c.disconnect_reason) &&
      (!search ||
        [c.summary, c.client_id, c.id]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const canReply =
    page === "client"
      ? !ended
      : !!staff &&
        view?.case.owner === staff.id &&
        view.case.status !== "resolved";
  function TracePanel() {
    return (
      <aside className="trace-panel">
        <div className="panel-title">
          <Activity size={17} />
          <h2>{tr("trace")}</h2>
          <span className="live-dot" />
        </div>
        {!latest ? (
          <div className="empty-small">
            <Radio size={28} />
            <p>{tr("noTrace")}</p>
          </div>
        ) : (
          <>
            <div className="scenario-list">
              {latest.scenarios.map((s) => (
                <div className="scenario-item" key={s.scenario_id}>
                  <span className="code">{s.scenario_id}</span>
                  <strong>{scenarioName(s.scenario_id, locale)}</strong>
                  <p className="subtle">
                    {scenarioDescription(s.scenario_id, locale)}
                  </p>
                  <small>
                    {tr("confidence")} <b>{Math.round(s.confidence * 100)}%</b>
                  </small>
                </div>
              ))}
            </div>
            <p className="reason">{latest.reason}</p>
            {latest.alternatives.length > 0 && (
              <section>
                <h3>{tr("alternatives")}</h3>
                {latest.alternatives.map((s) => (
                  <p key={s.scenario_id} className="subtle">
                    {s.scenario_id} · {scenarioName(s.scenario_id, locale)}
                  </p>
                ))}
              </section>
            )}
            <section>
              <h3>{tr("slots")}</h3>
              <dl>
                {Object.entries(latest.slots).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt>{tr(k)}</dt>
                    <dd>
                      {tr(String(v))
                        .replace(/\b\d{12}\b/g, "••••••••••••")
                        .replace(/\+7\d{10}/g, (x) => "+7 ••• " + x.slice(-4))}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            </section>
            <section>
              <h3>{tr("actions")}</h3>
              {(page === "staff" ? view!.actions : latest.actions).length ? (
                (page === "staff" ? view!.actions : latest.actions).map(
                  (a, i) => (
                    <div className="action-row" key={i}>
                      <span className={"action-dot " + a.mode} />
                      <div>
                        <code>{a.name}</code>
                        <small>{tr(a.mode)}</small>
                        {page === "staff" && (
                          <details>
                            <summary>{tr("viewDetails")}</summary>
                            <pre className="action-result">
                              {JSON.stringify(a.result, null, 2)
                                .replace(/\b\d{12}\b/g, "••••••••••••")
                                .replace(
                                  /\+7\d{10}/g,
                                  (x) => "+7 ••• " + x.slice(-4),
                                )}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  ),
                )
              ) : (
                <p className="subtle">{tr("noActions")}</p>
              )}
            </section>
            <section>
              <h3>{tr("sources")}</h3>
              {latest.sources.map((s) => (
                <p className="source" key={s}>
                  {s}
                </p>
              ))}
            </section>
            <section>
              <h3>{tr("latency")}</h3>
              <dl>
                {Object.entries(latest.latency_ms).map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt>{tr(k === "tts_first_audio" ? "tts" : k)}</dt>
                    <dd>
                      {v === null
                        ? tr("notMeasured")
                        : `${Math.round(v)} ${tr("ms")}`}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            </section>
          </>
        )}
      </aside>
    );
  }
  function Conversation() {
    return (
      <div className="conversation">
        <div className="conversation-head">
          <div>
            <span className="eyebrow">
              {tr("caseLabel")} · {view?.case.id.slice(0, 8)}
            </span>
            <h2>
              {scenarioName(
                view?.case.active || latest?.scenarios[0]?.scenario_id || null,
                locale,
              )}
            </h2>
          </div>
          <span className={"status " + view?.case.status}>
            {tr(view?.case.status || "open")}
          </span>
        </div>
        {view?.case.disconnect_reason && (
          <div className="notice">
            <History size={16} />
            {tr(view.case.disconnect_reason)} · {tr("continuity")}
          </div>
        )}
        {view?.case.next_step && (
          <div className="next-step">
            <span>{tr("nextStep")}</span>
            <strong>{nextLabel(view.case.next_step)}</strong>
          </div>
        )}
        <div className="messages" aria-live="polite">
          {!view?.messages.length && (
            <div className="empty-conversation">
              <MessageSquare size={34} />
              <h3>{tr("emptyHistory")}</h3>
              <p>{tr("voiceHint")}</p>
            </div>
          )}
          {view?.messages.map((m) => (
            <article className={"message " + m.role} key={m.id}>
              <div className="message-meta">
                <strong>{m.role === "client" ? tr("you") : tr(m.role)}</strong>
                <time>
                  {new Intl.DateTimeFormat(locale, {
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(m.at))}
                </time>
              </div>
              <p>{m.text}</p>
              {m.role !== "client" && (
                <small className="delivery">
                  {tr(
                    m.delivery === "interrupted"
                      ? "interruptedDelivery"
                      : m.delivery,
                  )}
                </small>
              )}
            </article>
          ))}
          {busy && (
            <div className="thinking">
              <span />
              <span />
              <span />
              <small>{tr("processing")}</small>
            </div>
          )}
          <div ref={messagesEnd} />
        </div>
        {view?.case.resume_candidates.length ? (
          <div className="resume-cases">
            <p>{tr("resumable")}</p>
            {view.case.resume_candidates.map((id) => (
              <button
                key={id}
                onClick={() =>
                  void api("/resume", { case_id: id }).then(setView).catch(fail)
                }
              >
                {tr("returnCase")} · {id.slice(0, 8)}
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
        ) : null}
        {view?.case.owner && (
          <div className="notice">
            <Headphones size={16} />
            {tr("humanNote")}
          </div>
        )}
        {canReply ? (
          <div className="composer-area">
            {page === "client" && (
              <div className="voice-row">
                <button
                  className={
                    "voice-button " +
                    (voiceState === "listening" ? "recording" : "")
                  }
                  disabled={
                    busy ||
                    ["connecting", "processing"].includes(voiceState) ||
                    !!view?.case.owner ||
                    view?.case.status === "waiting_operator"
                  }
                  onClick={() => {
                    if (voiceState === "listening") {
                      voice.current?.stop();
                      setVoiceState("processing");
                    } else void startVoice();
                  }}
                >
                  {voiceState === "listening" ? (
                    <Square size={16} />
                  ) : (
                    <Mic size={18} />
                  )}{" "}
                  {tr(voiceState === "listening" ? "stop" : "mic")}
                </button>
                <span className="voice-state">
                  <span className={"dot " + voiceState} />
                  {tr(voiceState)}
                </span>
                {voiceState === "processing" && (
                  <button
                    className="icon-button"
                    aria-label={tr("close")}
                    onClick={() => {
                      voice.current?.cancel();
                      setVoiceState("ready");
                    }}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            )}
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <input
                aria-label={tr("placeholder")}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={4000}
                placeholder={tr("placeholder")}
                disabled={busy}
              />
              <button
                className="send"
                disabled={busy || !input.trim()}
                aria-label={tr("send")}
              >
                <ArrowUp size={21} />
              </button>
            </form>
          </div>
        ) : ended ? (
          <div className="ended">
            <Check size={18} />
            {tr("callEnded")}
            <button onClick={() => void begin()}>{tr("newCall")}</button>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="app">
      <header>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("client");
          }}
        >
          <span className="brand-mark">
            <Radio size={24} />
          </span>
          <strong>
            Saqta<span>.</span>
          </strong>
          <span className="brand-caption">Voice Router</span>
        </a>
        <nav>
          <button
            className={page === "client" ? "nav-link active" : "nav-link"}
            onClick={() => navigate("client")}
          >
            {tr("client")}
          </button>
          <button
            className={page === "staff" ? "nav-link active" : "nav-link"}
            onClick={() => navigate("staff")}
          >
            <Headphones size={16} />
            {tr("workspace")}
          </button>
        </nav>
        <div className="header-right">
          <Globe2 size={16} />
          <select
            aria-label={tr("language")}
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            <option value="ru">Русский</option>
            <option value="kk">Қазақша</option>
            <option value="en">English</option>
          </select>
          {staff && page === "staff" && (
            <button
              className="icon-button"
              aria-label={tr("logout")}
              onClick={() =>
                void api("/staff/logout", {}).then(() => {
                  setStaff(null);
                  setView(null);
                })
              }
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </header>
      <div className="demo-banner">
        <span className="tiny-dot" />
        {tr("simulation")}
        <span>
          {new Intl.DateTimeFormat(
            locale === "en" ? "en-GB" : locale === "kk" ? "kk-KZ" : "ru-KZ",
          ).format(new Date("2026-10-01T12:00:00Z"))}
        </span>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error === "voiceUnavailable" ? tr(error) : errorText(error)}
          <button aria-label={tr("close")} onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {page === "client" && !auth ? (
        <main className="landing">
          <div className="hero-copy">
            <span className="eyebrow">Saqta Insurance</span>
            <h1>{tr("hero")}</h1>
            <p>{tr("intro")}</p>
            <button
              className="primary start"
              disabled={busy}
              onClick={() => void begin()}
            >
              {tr("start")}
              <ArrowUpRight size={21} />
            </button>
            <div className="trust">
              <ShieldCheck size={18} />
              {tr("safety")}
            </div>
          </div>
          <div className="voice-art" aria-hidden="true">
            <div className="art-top">
              <span>SAQTA / VOICE</span>
              <Radio size={20} />
            </div>
            <div className="sound-orbit">
              <div className="sound-bars">
                {Array.from({ length: 23 }, (_, i) => (
                  <i
                    key={i}
                    style={{
                      height:
                        12 +
                        Math.sin((i / 22) * Math.PI) * 100 +
                        Math.sin(i * 2) * 20 +
                        "px",
                      animationDelay: i * 0.08 + "s",
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="art-bottom">
              <span>RU / KK</span>
              <span>01 — 40</span>
            </div>
          </div>
          <div className="feature-strip">
            <div>
              <span>01</span>
              <h3>{tr("coverage")}</h3>
            </div>
            <div>
              <span>02</span>
              <h3>{tr("languages")}</h3>
            </div>
            <div>
              <span>03</span>
              <h3>{tr("continuity")}</h3>
            </div>
          </div>
          <p className="privacy">
            <LockKeyhole size={14} />
            {tr("privacy")}
          </p>
        </main>
      ) : page === "client" ? (
        <main className={"client-layout " + (!showTrace ? "no-trace" : "")}>
          <div className="call-toolbar">
            <span>
              <span className="live-dot" />
              {tr("product")}
            </span>
            <div>
              <button
                className="quiet"
                onClick={() => setShowTrace(!showTrace)}
              >
                <Activity size={16} />
                {tr(showTrace ? "hideTrace" : "showTrace")}
              </button>
              {ended ? (
                <button className="quiet" onClick={() => void begin()}>
                  {tr("newCall")}
                </button>
              ) : (
                <button className="end-call" onClick={() => void end()}>
                  <PhoneOff size={16} />
                  {tr("end")}
                </button>
              )}
            </div>
          </div>
          {Conversation()}
          {showTrace && TracePanel()}
          <p className="privacy">
            <LockKeyhole size={14} />
            {tr("privacy")}
          </p>
        </main>
      ) : !staff ? (
        <main className="login-page">
          <div className="login-card">
            <span className="login-icon">
              <Headphones size={30} />
            </span>
            <h1>{tr("staffLogin")}</h1>
            <p>{tr("staffHint")}</p>
            <form onSubmit={login}>
              <label>
                {tr("account")}
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="operator1">{tr("operator1")}</option>
                  <option value="operator2">{tr("operator2")}</option>
                  <option value="supervisor">{tr("supervisor")}</option>
                </select>
              </label>
              <label>
                {tr("password")}
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </label>
              <button className="primary" disabled={busy}>
                {tr("login")}
                <ArrowUpRight size={18} />
              </button>
            </form>
          </div>
        </main>
      ) : (
        <main className="staff-layout">
          <aside className="case-sidebar">
            <div className="sidebar-title">
              <h1>{tr("queue")}</h1>
              <span>{cases.length}</span>
            </div>
            <div className="search">
              <Search size={16} />
              <input
                placeholder={tr("filter")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="filters">
              {["all", "unassigned", "mine", "interrupted"].map((f) => (
                <button
                  key={f}
                  className={filter === f ? "selected" : ""}
                  onClick={() => setFilter(f)}
                >
                  {tr(f)}
                </button>
              ))}
            </div>
            <div className="case-list">
              {visibleCases.length ? (
                visibleCases.map((c) => (
                  <button
                    className={
                      "case-card " + (selected === c.id ? "selected" : "")
                    }
                    key={c.id}
                    onClick={() => {
                      setSelected(c.id);
                      setView(null);
                    }}
                  >
                    <div>
                      <span className="case-id">
                        {c.client_id || c.id.slice(0, 8)}
                      </span>
                      <span className="case-language">
                        {c.language.toUpperCase()}
                      </span>
                    </div>
                    <h3>{scenarioName(c.active, locale)}</h3>
                    <p>{c.summary || tr("describe_request")}</p>
                    <footer>
                      <span className={"status " + c.status}>
                        {tr(c.status)}
                      </span>
                      {c.disconnect_reason && <PhoneOff size={13} />}
                    </footer>
                  </button>
                ))
              ) : (
                <p className="empty-small">{tr("emptyQueue")}</p>
              )}
            </div>
            <div className="staff-identity">
              <span className="avatar">
                {staff.id === "supervisor" ? "S" : staff.id.slice(-1)}
              </span>
              <div>
                <strong>{tr(staff.id)}</strong>
                <small>{tr(staff.role)}</small>
              </div>
            </div>
          </aside>
          <div className="staff-main">
            {view && selected ? (
              <>
                <div className="staff-toolbar">
                  <div>
                    <span className="eyebrow">{tr("assigned")}</span>
                    <strong>
                      {view.case.owner
                        ? tr(view.case.owner)
                        : tr("unassignedLabel")}
                    </strong>
                  </div>
                  <div>
                    {!view.case.owner && view.case.status !== "resolved" && (
                      <button
                        className="primary"
                        onClick={() => void staffAction("claim")}
                      >
                        {tr("claim")}
                      </button>
                    )}
                    {(view.case.owner === staff.id ||
                      staff.role === "supervisor") && (
                      <>
                        <select
                          aria-label={tr("transfer")}
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                        >
                          <option value="operator1">{tr("operator1")}</option>
                          <option value="operator2">{tr("operator2")}</option>
                        </select>
                        <button
                          className="quiet"
                          onClick={() =>
                            void staffAction("transfer", { target })
                          }
                        >
                          {tr("transfer")}
                        </button>
                        <button
                          className="quiet"
                          onClick={() => void staffAction("resolve")}
                        >
                          {tr("resolve")}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="staff-detail">
                  {Conversation()}
                  {TracePanel()}
                </div>
              </>
            ) : (
              <div className="select-empty">
                <MessageSquare size={42} />
                <h2>{tr("selectCase")}</h2>
                <p>{tr("noSelection")}</p>
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
