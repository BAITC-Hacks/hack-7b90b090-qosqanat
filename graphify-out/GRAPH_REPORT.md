> Token usage: unavailable. Zero numeric counters below are library placeholders, not measured token usage.
> Corpus: task docs plus optional source AST; no secrets or runtime client history.
> DOCX: OOXML text inspected by extraction agent; built-in office conversion unavailable.

# Graph Report - hack-7b90b090-qosqanat  (2026-09-23)

## Corpus Check
- Corpus is ~23,701 words - fits in a single context window. You may not need a graph.

## Summary
- 511 nodes · 1089 edges · 31 communities (29 shown, 2 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 50 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- core/src/index.ts / AppError
- main.tsx / i18n/src/index.ts
- web/package.json / dependencies
- graph-docs.py / evaluate.py
- dev_utterances.json / kb_lookup
- dialogs_sample.json / SC02 OGPO purchase
- knowledge/src/index.ts / env.ts
- gateway/package.json / dependencies
- gateway/src/index.ts / processTurn()
- scenario-service/package.json / dependencies
- SC13 CASCO damage claim / SC12 Claim as victim under culprit's OGPO
- Explicit confirmation / find_client
- VoiceClient / .send()
- Grounded company facts / app_help
- ai/src/index.ts / OpenAIRouter
- dev.mjs / ref_node_fs
- scenario-service/src/index.ts / ref_zod
- LLM scenario router / Voice Router specification
- phone / SC26 Resend policy documents
- core/package.json / dependencies
- SC21 Doctor appointment under DMS / SC20 Book vehicle inspection
- SC06 Travel insurance purchase / SC39 Certificate or document copy request
- ai/package.json / dependencies
- db/package.json / dependencies
- RealtimeConnection / .route()
- SC22 DMS coverage check / SC10 Corporate insurance request
- SC19 Disagreement with claim decision / SC35 Service complaint
- knowledge/package.json / dependencies
- contracts/package.json / dependencies
- i18n/package.json / dependencies
- Synthetic backend / Synthetic claims

## God Nodes (most connected - your core abstractions)
1. `LLM scenario router` - 51 edges
2. `AppError` - 32 edges
3. `Store` - 31 edges
4. `Explicit confirmation` - 25 edges
5. `phone` - 21 edges
6. `find_client` - 17 edges
7. `App()` - 16 edges
8. `runAction()` - 16 edges
9. `SC13 CASCO damage claim` - 16 edges
10. `Engine` - 15 edges

## Surprising Connections (you probably didn't know these)
- `rate()` --calls--> `AppError`  [EXTRACTED]
  apps/gateway/src/index.ts → packages/contracts/src/index.ts
- `staff()` --calls--> `AppError`  [EXTRACTED]
  apps/gateway/src/index.ts → packages/contracts/src/index.ts
- `limited()` --calls--> `AppError`  [EXTRACTED]
  apps/gateway/src/index.ts → packages/contracts/src/index.ts
- `renew_policy` --references--> `Explicit confirmation`  [EXTRACTED]
  docs/voice_router_dataset/actions.json → docs/voice_router_dataset/README.ru.md
- `create_dispute` --references--> `Explicit confirmation`  [EXTRACTED]
  docs/voice_router_dataset/actions.json → docs/voice_router_dataset/README.ru.md

## Import Cycles
- None detected.

## Communities (31 total, 2 thin omitted)

### Community 0 - "core/src/index.ts / AppError"
Cohesion: 0.07
Nodes (46): interval, ActionEvent, AppError, CaseState, Decision, Language, languages, Message (+38 more)

### Community 1 - "main.tsx / i18n/src/index.ts"
Cohesion: 0.10
Nodes (32): account(), App(), api(), begin(), Conversation(), end(), login(), send() (+24 more)

### Community 2 - "web/package.json / dependencies"
Cohesion: 0.08
Nodes (23): dependencies, lucide-react, react, react-dom, @voice/contracts, @voice/i18n, devDependencies, vite (+15 more)

### Community 3 - "graph-docs.py / evaluate.py"
Cohesion: 0.10
Nodes (17): collections, Reference router evaluator for Voice Router. Usage: python evaluate.py…, graphify_analyze, graphify_build, graphify_cluster, graphify_detect, graphify_export, graphify_extract (+9 more)

### Community 4 - "dev_utterances.json / kb_lookup"
Cohesion: 0.14
Nodes (20): calc_accident_price, calc_property_price, create_callback, kb_lookup, Routing evaluation, SC07 Home insurance consultation, SC08 Accident insurance consultation, SC18 Documents for a claim (+12 more)

### Community 5 - "dialogs_sample.json / SC02 OGPO purchase"
Cohesion: 0.16
Nodes (18): calc_casco_price, calc_ogpo_price, get_bm_class, renew_policy, SC01 OGPO price quote, SC02 OGPO purchase, SC03 CASCO consultation and quote, SC27 Policy renewal (+10 more)

### Community 6 - "knowledge/src/index.ts / env.ts"
Cohesion: 0.13
Nodes (15): actions, dataDir, kb, queues, root, scenarios, slots, systems (+7 more)

### Community 7 - "gateway/package.json / dependencies"
Cohesion: 0.11
Nodes (17): dependencies, @voice/ai, @voice/contracts, @voice/core, @voice/db, @voice/knowledge, @voice/ai, @voice/contracts (+9 more)

### Community 8 - "gateway/src/index.ts / processTurn()"
Cohesion: 0.12
Nodes (14): app, core(), limited(), locks, processTurn(), rate(), rates, router (+6 more)

### Community 9 - "scenario-service/package.json / dependencies"
Cohesion: 0.11
Nodes (17): dependencies, @voice/ai, @voice/contracts, @voice/core, @voice/db, @voice/knowledge, @voice/ai, @voice/contracts (+9 more)

### Community 10 - "SC13 CASCO damage claim / SC12 Claim as victim under culprit's OGPO"
Cohesion: 0.28
Nodes (18): create_claim, get_policy, send_sms, transfer_to_operator, Operator handoff, Urgent scenarios first, SC11 Road accident just happened, SC12 Claim as victim under culprit's OGPO (+10 more)

### Community 11 - "Explicit confirmation / find_client"
Cohesion: 0.26
Nodes (15): cancel_policy, find_client, update_contact, update_policy, Explicit confirmation, SC04 Add driver to motor policy, SC05 Change vehicle or plate in policy, SC24 DMS e-card issue (+7 more)

### Community 13 - "Grounded company facts / app_help"
Cohesion: 0.14
Nodes (14): app_help, bonus_malus, cancellation, claims, clinics, company, complaints, documents_available (+6 more)

### Community 14 - "ai/src/index.ts / OpenAIRouter"
Cohesion: 0.19
Nodes (10): narrate(), OpenAIRouter, routeTool, routingInstructions, RoutingProvider, decisionSchema, ReplyPlan, AS_OF (+2 more)

### Community 15 - "dev.mjs / ref_node_fs"
Cohesion: 0.18
Nodes (9): ref_dotenv, ref_node_child_process, ref_node_fs, ref_node_os, children, env, local, r (+1 more)

### Community 16 - "scenario-service/src/index.ts / ref_zod"
Cohesion: 0.17
Nodes (8): app, db, engine, server, token(), validateCatalog(), ref_express, ref_zod

### Community 17 - "LLM scenario router / Voice Router specification"
Cohesion: 0.20
Nodes (12): 100-point scoring rubric, Single-command launch, Voice Router specification, Web microphone voice interaction, Dataset guide README.md, Dataset guide README.kz.md, Dialogue state, Russian Kazakh mixed speech (+4 more)

### Community 18 - "phone / SC26 Resend policy documents"
Cohesion: 0.21
Nodes (12): check_payment, get_policies, report_fraud, resend_documents, SC25 Check policy validity, SC26 Resend policy documents, SC30 Charged but policy not issued, SC38 Suspicious call or fraud report (+4 more)

### Community 19 - "core/package.json / dependencies"
Cohesion: 0.17
Nodes (11): dependencies, @voice/contracts, @voice/db, @voice/knowledge, exports, @voice/contracts, @voice/db, @voice/knowledge (+3 more)

### Community 20 - "SC21 Doctor appointment under DMS / SC20 Book vehicle inspection"
Cohesion: 0.25
Nodes (11): book_appointment, book_inspection, get_offices, list_clinics, SC20 Book vehicle inspection, SC21 Doctor appointment under DMS, SC23 Partner clinics list, SC33 Office addresses and hours (+3 more)

### Community 21 - "SC06 Travel insurance purchase / SC39 Certificate or document copy request"
Cohesion: 0.18
Nodes (11): calc_travel_price, create_policy, request_document, SC06 Travel insurance purchase, SC39 Certificate or document copy request, document_type, traveler_max_age, travelers_count (+3 more)

### Community 22 - "ai/package.json / dependencies"
Cohesion: 0.20
Nodes (9): dependencies, @voice/contracts, @voice/knowledge, exports, @voice/contracts, @voice/knowledge, name, private (+1 more)

### Community 23 - "db/package.json / dependencies"
Cohesion: 0.20
Nodes (9): dependencies, @voice/contracts, @voice/knowledge, exports, @voice/contracts, @voice/knowledge, name, private (+1 more)

### Community 25 - "SC22 DMS coverage check / SC10 Corporate insurance request"
Cohesion: 0.29
Nodes (8): check_coverage, SC09 Individual health insurance consultation, SC10 Corporate insurance request, SC22 DMS coverage check, company_name, email, employees_count, service_name

### Community 26 - "SC19 Disagreement with claim decision / SC35 Service complaint"
Cohesion: 0.36
Nodes (8): create_complaint, create_dispute, get_claim, SC17 Claim status, SC19 Disagreement with claim decision, SC35 Service complaint, claim_number, complaint_text

### Community 27 - "knowledge/package.json / dependencies"
Cohesion: 0.25
Nodes (7): dependencies, @voice/contracts, exports, @voice/contracts, name, private, type

### Community 28 - "contracts/package.json / dependencies"
Cohesion: 0.33
Nodes (5): dependencies, exports, name, private, type

### Community 29 - "i18n/package.json / dependencies"
Cohesion: 0.33
Nodes (5): dependencies, exports, name, private, type

### Community 30 - "Synthetic backend / Synthetic claims"
Cohesion: 0.40
Nodes (5): Synthetic claims, Synthetic clients, Synthetic payments, Synthetic policies, Synthetic backend

## Knowledge Gaps
- **196 isolated node(s):** `name`, `private`, `type`, `dev`, `start` (+191 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 233 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `LLM scenario router` connect `LLM scenario router / Voice Router specification` to `dev_utterances.json / kb_lookup`, `dialogs_sample.json / SC02 OGPO purchase`, `SC13 CASCO damage claim / SC12 Claim as victim under culprit's OGPO`, `Explicit confirmation / find_client`, `phone / SC26 Resend policy documents`, `SC21 Doctor appointment under DMS / SC20 Book vehicle inspection`, `SC06 Travel insurance purchase / SC39 Certificate or document copy request`, `SC22 DMS coverage check / SC10 Corporate insurance request`, `SC19 Disagreement with claim decision / SC35 Service complaint`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `Store` connect `core/src/index.ts / AppError` to `scenario-service/src/index.ts / ref_zod`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `VoiceClient` connect `VoiceClient / .send()` to `main.tsx / i18n/src/index.ts`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **What connects `name`, `private`, `type` to the rest of the system?**
  _196 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `core/src/index.ts / AppError` be split into smaller, more focused modules?**
  _Cohesion score 0.0658835546475996 - nodes in this community are weakly interconnected._
- **Should `main.tsx / i18n/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10252100840336134 - nodes in this community are weakly interconnected._
- **Should `web/package.json / dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._