import type { VoiceEvent } from "./voice";
import { Microphone } from "./capture";
import { VoiceActivity, pcmBase64 } from "./vad";
export class LiveVoiceClient {
  ws: WebSocket | null = null;
  enabled = false;
  muted = false;
  private mic = new Microphone();
  private vad = new VoiceActivity();
  private output: AudioContext | null = null;
  private nodes: AudioBufferSourceNode[] = [];
  private next = 0;
  private response = "";
  private message = "";
  private turn = "";
  private seenSeq = 0;
  private connection = "";
  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private ignored = new Set<string>();
  private closed = false;
  private receiving = false;
  private inputEnabled = false;
  private started = false;
  constructor(
    private token: string,
    private event: (e: VoiceEvent) => void,
  ) {}
  async start() {
    this.closed = false;
    try {
      // Start the permission request in the click gesture, before any await.
      const capture = this.mic.start((samples) => this.frame(samples));
      this.output = new AudioContext({ sampleRate: 24000 });
      await Promise.all([this.output.resume(), capture]);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(Error("transcription_unavailable"));
          this.close();
        }, 20000);
        this.ws = new WebSocket(
          `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`,
        );
        this.ws.onopen = () => this.send({ type: "auth", token: this.token });
        this.ws.onmessage = (msg) => {
          const e = JSON.parse(msg.data);
          if (this.connection && this.connection !== e.connection_id) return;
          this.connection = e.connection_id;
          if (e.seq <= this.seenSeq) return;
          this.seenSeq = e.seq;
          if (e.type === "ping") {
            this.send({ type: "pong" });
            return;
          }
          if (e.type === "ready") {
            clearTimeout(timer);
            this.enabled = true;
            this.started = true;
            this.inputEnabled = true;
            this.event({ type: "voice.enabled" });
            this.event({ type: "listening" });
            resolve();
            return;
          }
          if (
            ["transcript.final", "response.start", "audio_done"].includes(
              e.type,
            )
          )
            console.debug(
              "voice.transition",
              JSON.stringify({
                stage: e.type,
                at_ms: Math.round(performance.now()),
              }),
            );
          if (e.type === "error") {
            clearTimeout(timer);
            if (!this.started) reject(Error(e.code));
            this.event(e);
            return;
          }
          if (e.type === "handoff") {
            this.event(e);
            this.close();
            return;
          }
          if (e.type === "response.start") {
            this.stopPlayback();
            this.response = e.response_id;
            this.message = e.message?.id || "";
            this.receiving = true;
            this.event(e);
            return;
          }
          if (e.type === "response.cancelled") {
            this.ignored.add(e.response_id);
            if (e.response_id === this.response) {
              this.stopPlayback();
              this.receiving = false;
              this.event(e);
            }
            return;
          }
          if (e.response_id && this.ignored.has(e.response_id)) return;
          if (e.type === "audio") {
            if (e.response_id === this.response)
              this.play(e.audio, e.message_id);
            return;
          }
          if (e.type === "audio_done") {
            if (e.response_id !== this.response) return;
            const response = e.response_id,
              message = e.message_id;
            this.playbackTimer = setTimeout(
              () => {
                if (this.response !== response || this.ignored.has(response))
                  return;
                this.nodes = [];
                this.next = 0;
                this.receiving = false;
                this.send({
                  type: "played",
                  response_id: response,
                  message_id: message,
                });
                this.event({ type: "listening" });
              },
              Math.max(
                0,
                (this.next - (this.output?.currentTime || 0)) * 1000,
              ) + 60,
            );
            return;
          }
          if (e.type === "input.ready") this.inputEnabled = true;
          this.event(e);
        };
        this.ws.onerror = () => {
          clearTimeout(timer);
          reject(Error("connection_lost"));
        };
        this.ws.onclose = () => {
          clearTimeout(timer);
          if (!this.started) reject(Error("connection_lost"));
          const wasEnabled = this.enabled;
          this.cleanup();
          if (!this.closed && wasEnabled) this.event({ type: "disconnected" });
        };
      });
    } catch (e) {
      this.close();
      throw e;
    }
  }
  private frame(samples: Float32Array) {
    if (!this.enabled) {
      this.vad.push(samples);
      this.vad.reset();
      return;
    }
    if (!this.enabled || !this.inputEnabled || this.muted) return;
    for (const e of this.vad.push(
      samples,
      this.receiving || this.nodes.length > 0,
    )) {
      if (e.type === "start") {
        this.interrupt();
        this.turn = crypto.randomUUID();
        this.send({ type: "speech_start", turn_id: this.turn });
        this.event({ type: "speech.started", turn_id: this.turn });
      }
      if (e.type === "audio")
        this.send({
          type: "audio",
          turn_id: this.turn,
          audio: pcmBase64(e.samples!),
        });
      if (e.type === "end") {
        console.debug(
          "voice.transition",
          JSON.stringify({
            stage: "speech_end",
            at_ms: Math.round(performance.now()),
          }),
        );
        this.send({ type: "speech_end", turn_id: this.turn });
        this.event({ type: "transcribing", turn_id: this.turn });
        this.turn = "";
      }
    }
  }
  send(e: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (this.ws.bufferedAmount > 1024 * 1024) {
        this.event({ type: "error", code: "connection_lost" });
        this.close();
        return;
      }
      this.ws.send(JSON.stringify(e));
    }
  }
  sendText(text: string) {
    this.interrupt();
    this.vad.reset();
    if (this.turn)
      this.event({ type: "transcript.cancelled", turn_id: this.turn });
    this.inputEnabled = false;
    this.turn = "";
    this.send({ type: "text", turn_id: crypto.randomUUID(), text });
  }
  mute() {
    this.muted = !this.muted;
    this.mic.mute(this.muted);
    this.vad.reset();
    if (this.turn) {
      // Muting ends capture; it must not discard the user's current utterance.
      this.send({ type: "speech_end", turn_id: this.turn });
      this.event({ type: "transcribing", turn_id: this.turn });
      this.turn = "";
    }
    this.event({ type: this.muted ? "muted" : "listening" });
  }
  interrupt() {
    if (this.response && this.receiving) {
      this.ignored.add(this.response);
      this.send({ type: "cancel" });
      this.event({ type: "response.cancelled", response_id: this.response });
      this.receiving = false;
    }
    this.stopPlayback();
  }
  private play(audio: string, id: string) {
    if (!this.output) return;
    const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
    const pcm = new Int16Array(bytes.buffer);
    const buffer = this.output.createBuffer(1, pcm.length, 24000);
    const f = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) f[i] = pcm[i]! / 32768;
    const node = this.output.createBufferSource();
    node.buffer = buffer;
    node.connect(this.output.destination);
    const at = Math.max(this.output.currentTime + 0.02, this.next);
    node.start(at);
    this.next = at + buffer.duration;
    this.nodes.push(node);
    node.onended = () => {
      this.nodes = this.nodes.filter((n) => n !== node);
    };
    if (this.nodes.length === 1)
      console.debug(
        "voice.transition",
        JSON.stringify({
          stage: "audio_scheduled",
          at_ms: Math.round(performance.now()),
        }),
      );
    this.message = id;
    this.event({ type: "speaking" });
  }
  private stopPlayback() {
    if (this.playbackTimer) clearTimeout(this.playbackTimer);
    this.playbackTimer = null;
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {}
    }
    this.nodes = [];
    this.next = 0;
  }
  private cleanup() {
    this.enabled = false;
    this.inputEnabled = false;
    this.mic.close();
    this.vad.reset();
    this.stopPlayback();
    void this.output?.close().catch(() => {});
    this.output = null;
    this.event({ type: "voice.disabled" });
  }
  close() {
    this.closed = true;
    this.interrupt();
    this.ws?.close(1000, "client_view_closed");
    this.ws = null;
    this.cleanup();
  }
}
