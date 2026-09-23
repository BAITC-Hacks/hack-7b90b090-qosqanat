import "../../scripts/env.js";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { root } from "@voice/knowledge";
const reports = [];
for (const [language, text] of [
  ["ru", "Где находится ваш офис в Алматы?"],
  ["kk", "Астанадағы кеңсеңіздің мекенжайы қандай?"],
  ["mixed", "Сәлеметсіз бе, где ваш офис в Шымкенте?"],
]) {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.OPENAI_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: text,
      response_format: "pcm",
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error("Synthetic audio generation failed: " + r.status);
  const audio = Buffer.from(await r.arrayBuffer());
  const session: any = await (
    await fetch("http://localhost:3000/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: "+7701777000" + reports.length,
        locale: language === "kk" ? "kk" : "ru",
      }),
    })
  ).json();
  await fetch("http://localhost:3000/api/start", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + session.token,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const report: any = await new Promise((resolve, reject) => {
    const ws = new WebSocket("ws://localhost:3000/api/voice", {
      headers: { Origin: "http://localhost:3000" },
    });
    let phase = "connect",
      end = 0,
      first: number | null = null,
      transcript = "",
      scenario = "",
      bytes = 0,
      greetingBytes = 0;
    const timer = setTimeout(() => finish(Error("voice_timeout")), 90000);
    function finish(error?: Error) {
      clearTimeout(timer);
      ws.close();
      error
        ? reject(error)
        : resolve({
            language,
            transcript,
            scenario,
            greeting_audio_bytes: greetingBytes,
            audio_bytes: bytes,
            end_to_first_audio_ms: first,
          });
    }
    ws.on("open", () =>
      ws.send(JSON.stringify({ type: "auth", token: session.token })),
    );
    ws.on("error", () => finish(Error("ws_error")));
    ws.on("message", async (raw) => {
      const e = JSON.parse(raw.toString());
      if (e.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
      if (e.type === "error") finish(Error(e.code));
      if (e.type === "greeting_done") {
        if (!greetingBytes) {
          finish(Error("missing_greeting_audio"));
          return;
        }
        phase = "start";
        ws.send(JSON.stringify({ type: "start" }));
      }
      if (phase === "greeting") {
        if (e.type === "audio")
          greetingBytes += Buffer.byteLength(e.audio, "base64");
        return;
      }
      if (e.type === "ready" && phase === "connect") {
        phase = "greeting";
        ws.send(JSON.stringify({ type: "greeting" }));
      }
      if (e.type === "recording") {
        for (let i = 0; i < audio.length; i += 24000)
          ws.send(
            JSON.stringify({
              type: "audio",
              audio: audio.subarray(i, i + 24000).toString("base64"),
            }),
          );
        end = performance.now();
        ws.send(JSON.stringify({ type: "stop", turn_id: randomUUID() }));
      }
      if (e.type === "transcript") transcript = e.text;
      if (e.type === "result")
        scenario = e.view.traces.at(-1).scenarios[0].scenario_id;
      if (e.type === "audio") {
        first ??= Math.round(performance.now() - end);
        bytes += Buffer.byteLength(e.audio, "base64");
      }
      if (e.type === "audio_done") finish();
    });
  });
  reports.push(report);
  console.log(JSON.stringify(report));
}
mkdirSync(root + "/evals/artifacts", { recursive: true });
writeFileSync(
  root + "/evals/artifacts/voice.json",
  JSON.stringify(
    {
      kind: "synthetic audio through live gateway and OpenAI; not human microphone evaluation",
      reports,
    },
    null,
    2,
  ),
);
