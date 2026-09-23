import WebSocket from "ws";
/** One committed input item at a time; provider item IDs prevent stale finals. */
export class LiveTranscriber {
  ws: WebSocket;
  ready: Promise<void>;
  private pending: {
    id: string;
    text: string;
    item?: string;
    resolve?: (v: string) => void;
    reject?: (e: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
  } | null = null;
  private closed = false;
  constructor(
    private onDelta: (id: string, text: string) => void,
    private onFailure: (e: Error) => void = () => {},
  ) {
    this.ws = new WebSocket(
      "wss://api.openai.com/v1/realtime?intent=transcription",
      {
        headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY },
        handshakeTimeout: 15000,
        maxPayload: 1024 * 1024,
      },
    );
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(Error("transcription_unavailable"));
        this.close();
      }, 15000);
      const fail = (error: Error) => {
        clearTimeout(timeout);
        reject(error);
        this.pending?.reject?.(error);
        if (this.pending?.timer) clearTimeout(this.pending.timer);
        this.pending = null;
        if (!this.closed) this.onFailure(error);
      };
      this.ws.on("open", () =>
        this.send({
          type: "session.update",
          session: {
            type: "transcription",
            audio: {
              input: {
                format: { type: "audio/pcm", rate: 24000 },
                transcription: {
                  model:
                    process.env.TRANSCRIPTION_MODEL || "gpt-live-transcribe",
                  languages: ["ru", "kk"],
                  prompt:
                    "Страховой контакт-центр Saqta. Русская, казахская и смешанная речь. Русскую и казахскую речь пишите кириллицей. Приветствие: «Сәлеметсіз бе». Сохраняйте язык оригинала.",
                  delay: "low",
                },
                turn_detection: null,
              },
            },
          },
        }),
      );
      this.ws.on("message", (data) => {
        const e = JSON.parse(String(data));
        if (
          e.type === "session.updated" ||
          e.type === "transcription_session.updated"
        ) {
          clearTimeout(timeout);
          resolve();
        }
        if (e.type === "error") {
          fail(Error(e.error?.code || "transcription_unavailable"));
          return;
        }
        const p = this.pending;
        if (!p) return;
        if (e.type === "input_audio_buffer.committed") {
          p.item = e.item_id;
          return;
        }
        if (!e.type?.startsWith("conversation.item.input_audio_transcription."))
          return;
        if (p.item && p.item !== e.item_id) return;
        p.item = e.item_id;
        if (e.type.endsWith(".delta")) {
          p.text += e.delta || "";
          this.onDelta(p.id, p.text);
        }
        if (e.type.endsWith(".completed")) {
          clearTimeout(p.timer);
          this.pending = null;
          p.resolve?.(e.transcript || p.text);
        }
        if (e.type.endsWith(".failed")) fail(Error("transcription_failed"));
      });
      this.ws.on("error", () => fail(Error("transcription_unavailable")));
      this.ws.on("close", () => fail(Error("transcription_closed")));
    });
  }
  private send(e: unknown) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(e));
  }
  begin(id: string) {
    if (this.pending) throw Error("transcription_busy");
    this.pending = { id, text: "" };
  }
  append(audio: string) {
    if (!this.pending) throw Error("invalid_state");
    this.send({ type: "input_audio_buffer.append", audio });
  }
  commit(): Promise<string> {
    const p = this.pending;
    if (!p) return Promise.reject(Error("invalid_state"));
    return new Promise((resolve, reject) => {
      p.resolve = resolve;
      p.reject = reject;
      p.timer = setTimeout(() => {
        if (this.pending === p) this.pending = null;
        reject(Error("transcription_timeout"));
        this.close();
      }, 15000);
      this.send({ type: "input_audio_buffer.commit" });
    });
  }
  close() {
    this.closed = true;
    const p = this.pending;
    this.pending = null;
    clearTimeout(p?.timer);
    p?.reject?.(Error("cancelled"));
    if (this.ws.readyState === WebSocket.CONNECTING) this.ws.terminate();
    else this.ws.close();
  }
}
