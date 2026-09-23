import "../../scripts/env.js";
import { LiveTranscriber } from "@voice/ai";
import assert from "node:assert/strict";
const phrases = [
  [
    "ru",
    "Здравствуйте, я хотел бы узнать, где находится ваш офис в Алматы и в какое время он работает.",
  ],
  [
    "kk",
    "Сәлеметсіз бе, Алматыдағы кеңсеңіз қай жерде орналасқан және жұмыс уақыты қандай?",
  ],
  [
    "mixed",
    "Сәлеметсіз бе, я хочу узнать, где ваш офис в Алматы, жұмыс уақыты қандай?",
  ],
];
for (const [language, text] of phrases) {
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
  assert(r.ok);
  const audio = Buffer.from(await r.arrayBuffer());
  let committed = false,
    early = 0,
    first: number | undefined;
  const start = Date.now();
  const stt = new LiveTranscriber((_id, _text) => {
    first ??= Date.now() - start;
    if (!committed) early++;
  });
  try {
    await stt.ready;
    stt.begin(language!);
    for (let i = 0; i < audio.length; i += 4800) {
      stt.append(audio.subarray(i, i + 4800).toString("base64"));
      await new Promise((r) => setTimeout(r, 100));
    }
    committed = true;
    const final = await stt.commit();
    assert(early > 0, "No transcript before commit");
    assert(final.trim());
    console.log(
      JSON.stringify({
        language,
        early_deltas: early,
        first_text_ms: first,
        final,
      }),
    );
  } finally {
    stt.close();
  }
}
