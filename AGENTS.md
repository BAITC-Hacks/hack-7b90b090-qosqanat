# Voice Router

pnpm monorepo. Node 22.13+; TypeScript strict, ESM. Apps are processes; packages are libraries.

- Keep docs/voice_router_dataset immutable. It contains synthetic insurance data.
- Only scenario-service and core write business state through db. AI decisions are untrusted.
- Never read secrets into output. Never include .env, var/, logs/, histories or credentials in Graphify.
- Irreversible actions require server-owned pending preview and explicit confirmation of unchanged parameters. Preserve idempotency.
- All UI strings belong in packages/i18n; support ru, kk, en independently of conversation language.
- Graphify 0.9.65 is a development tool. Query the existing graph before architecture questions, use path/explain to check dependencies. Verify findings against source. Refresh after completed edits with the Graphify Python runtime: scripts/graph-docs.py --code.
- Read and apply installed smixs/humanizer-ru to Russian user-facing copy and README. Preserve factual and safety meaning. Run its linter and blind review as instructed by the skill.
- Validate: pnpm typecheck, pnpm test, pnpm build; live API evals separately with pnpm eval.
- Do not claim mocked tests prove live speech quality. Document measured evidence and limitations.
