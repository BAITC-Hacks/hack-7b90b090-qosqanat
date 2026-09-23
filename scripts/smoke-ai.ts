import "./env.js";
import { OpenAIRouter, narrate } from "../packages/ai/src/index.js";
try {
  const result = await new OpenAIRouter().route("Где ваш офис в Алматы?", {});
  console.log(
    JSON.stringify({
      model: result.model,
      scenarios: result.decision.scenarios,
      language: result.decision.language,
      latency: result.latency,
    }),
  );
  const reply = await narrate({
    kind: "facts",
    language: "ru",
    instruction: "Answer the office address and hours.",
    facts: {
      address: "Abai Ave 150",
      hours: "Mon-Fri 09:00-18:00, Sat 10:00-15:00",
    },
    sources: [],
  });
  console.log(reply);
} catch (e) {
  console.log("Smoke failed:", e instanceof Error ? e.message : "error");
  process.exitCode = 1;
}
