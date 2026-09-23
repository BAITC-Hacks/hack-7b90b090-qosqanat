import "../../scripts/env.js";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
const base = "http://localhost:3000/api";
const reports = await Promise.all(
  [
    [
      "ru",
      "Здравствуйте, подскажите, пожалуйста, где находится ваш офис в Алматы и в какое время он работает?",
    ],
    [
      "kk",
      "Сәлеметсіз бе, Алматыдағы кеңсеңіз қай жерде орналасқан және жұмыс уақыты қандай?",
    ],
    [
      "mixed",
      "Сәлеметсіз бе, я хочу узнать, где ваш офис в Алматы, жұмыс уақыты қандай?",
    ],
  ].map(async ([language, text], index) => {
    const speech = await fetch("https://api.openai.com/v1/audio/speech", {
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
    });
    assert(speech.ok);
    const pcm = Buffer.from(await speech.arrayBuffer());
    const post = async (path: string, body: unknown, token?: string) => {
      const r = await fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: JSON.stringify(body),
      });
      assert(r.ok, `${path}: ${r.status}`);
      return (await r.json()) as any;
    };
    const session = await post("/sessions", {
      phone: "+7701777888" + index,
      locale: language === "kk" ? "kk" : "ru",
    });
    await post("/start", {}, session.token);
    const result = await new Promise<any>((resolve, reject) => {
      const ws = new WebSocket("ws://localhost:3000/api/live", {
        headers: { Origin: "http://localhost:3000" },
      });
      let phase = "greeting",
        sentEnd = false,
        firstDelta: number | undefined,
        firstAudio: number | undefined,
        firstAnswer: number | undefined,
        doneText: number | undefined,
        bytes = 0,
        early = 0,
        start = 0,
        end = 0,
        final = "",
        response = "",
        lastSeq = 0,
        caseid = "";
      const turn = randomUUID();
      const timer = setTimeout(() => finish(Error("timeout")), 120000);
      function finish(e?: Error) {
        clearTimeout(timer);
        ws.close(1000, "client_view_closed");
        e
          ? reject(e)
          : resolve({
              language,
              case_id: caseid,
              early_deltas: early,
              first_transcript_ms: firstDelta,
              first_answer_ms: firstAnswer,
              first_audio_ms: firstAudio,
              answer_done_ms: doneText,
              audio_bytes: bytes,
              transcript: final,
            });
      }
      async function input() {
        phase = "input";
        start = performance.now();
        ws.send(JSON.stringify({ type: "speech_start", turn_id: turn }));
        for (let i = 0; i < pcm.length; i += 4800) {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(
            JSON.stringify({
              type: "audio",
              turn_id: turn,
              audio: pcm.subarray(i, i + 4800).toString("base64"),
            }),
          );
          await new Promise((r) => setTimeout(r, 100));
        }
        end = performance.now();
        sentEnd = true;
        ws.send(JSON.stringify({ type: "speech_end", turn_id: turn }));
      }
      ws.on("open", () =>
        ws.send(JSON.stringify({ type: "auth", token: session.token })),
      );
      ws.on("error", finish);
      ws.on("message", (raw) => {
        try {
          const e = JSON.parse(String(raw));
          assert(e.seq > lastSeq);
          lastSeq = e.seq;
          if (e.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
          if (e.type === "error") return finish(Error(e.code));
          if (e.type === "response.start") response = e.response_id;
          if (e.type === "audio_done") {
            ws.send(
              JSON.stringify({
                type: "played",
                response_id: e.response_id,
                message_id: e.message_id,
              }),
            );
            if (phase === "greeting") {
              void input();
              return;
            }
            assert(early > 0, "no partial transcript before speech end");
            assert(bytes > 0);
            assert(firstAnswer !== undefined);
            assert(doneText !== undefined);
            assert(firstAnswer <= doneText);
            finish();
            return;
          }
          if (phase === "greeting") return;
          if (e.type === "transcript.delta") {
            if (!sentEnd) early++;
            firstDelta ??= Math.round(performance.now() - start);
          }
          if (e.type === "transcript.final") final = e.text;
          if (e.type === "response.delta")
            firstAnswer ??= Math.round(performance.now() - end);
          if (e.type === "response.done")
            doneText = Math.round(performance.now() - end);
          if (e.type === "audio") {
            assert.equal(e.response_id, response);
            bytes += Buffer.byteLength(e.audio, "base64");
            firstAudio ??= Math.round(performance.now() - end);
          }
          if (e.type === "result" && e.view) {
            caseid = e.view.case.id;
            assert.equal(caseid, session.case_id);
            assert(
              e.view.messages.filter((m: any) => m.role === "client").length <=
                1,
            );
          }
        } catch (e) {
          finish(e as Error);
        }
      });
    });
    await post("/end", {}, session.token);
    console.log(JSON.stringify(result));
    return result;
  }),
);
assert.equal(new Set(reports.map((r) => r.case_id)).size, 3);
mkdirSync("evals/artifacts", { recursive: true });
writeFileSync(
  "evals/artifacts/live-voice.json",
  JSON.stringify(
    {
      kind: "Synthetic audio, three concurrent live sessions; no human microphone test",
      reports,
    },
    null,
    2,
  ),
);
