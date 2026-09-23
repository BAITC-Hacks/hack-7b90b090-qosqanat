> Token usage: unavailable. Zero numeric counters below are library placeholders, not measured token usage.
> Corpus: task docs plus optional source AST; no secrets or runtime client history.
> DOCX: OOXML text inspected by extraction agent; built-in office conversion unavailable.

# Graph Report - hack-7b90b090-qosqanat  (2026-09-23)

## Corpus Check
- Corpus is ~24,223 words - fits in a single context window. You may not need a graph.

## Summary
- 590 nodes · 1356 edges · 33 communities (32 shown, 1 thin omitted)
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 83 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- gateway/src/index.ts / ai/src/index.ts
- Store / .get()
- main.tsx / i18n/src/index.ts
- VoiceClient / LiveVoiceClient
- web/package.json / dependencies
- graph-docs.py / evaluate.py
- dev_utterances.json / kb_lookup
- knowledge/src/index.ts / env.ts
- dialogs_sample.json / SC02 OGPO purchase
- core/src/index.ts / engine.test.ts
- gateway/package.json / dependencies
- scenario-service/package.json / dependencies
- SC13 CASCO damage claim / SC12 Claim as victim under culprit's OGPO
- contracts/src/index.ts / db/src/index.ts
- AppError / actions.ts
- Explicit confirmation / find_client
- Grounded company facts / app_help
- ref_node_crypto / ref_node_fs
- scenario-service/src/index.ts / createSessionSchema
- LLM scenario router / Voice Router specification
- phone / SC26 Resend policy documents
- core/package.json / dependencies
- db/package.json / dependencies
- SC21 Doctor appointment under DMS / SC20 Book vehicle inspection
- SC06 Travel insurance purchase / SC39 Certificate or document copy request
- ai/package.json / dependencies
- SC22 DMS coverage check / SC10 Corporate insurance request
- SC19 Disagreement with claim decision / SC35 Service complaint
- knowledge/package.json / dependencies
- contracts/package.json / dependencies
- i18n/package.json / dependencies
- Synthetic backend / Synthetic claims
- VoiceCapture / voice-worklet.js

## God Nodes (most connected - your core abstractions)
1. `LLM scenario router` - 51 edges
2. `AppError` - 42 edges
3. `Store` - 39 edges
4. `Explicit confirmation` - 25 edges
5. `App()` - 22 edges
6. `Engine` - 22 edges
7. `phone` - 21 edges
8. `find_client` - 17 edges
9. `runAction()` - 16 edges
10. `SC13 CASCO damage claim` - 16 edges

## Surprising Connections (you probably didn't know these)
- `rate()` --calls--> `AppError`  [EXTRACTED]
  apps/gateway/src/index.ts → packages/contracts/src/index.ts
- `clientToken()` --calls--> `AppError`  [EXTRACTED]
  apps/gateway/src/index.ts → packages/contracts/src/index.ts
- `staff()` --calls--> `AppError`  [EXTRACTED]
  apps/gateway/src/index.ts → packages/contracts/src/index.ts
- `limited()` --calls--> `AppError`  [EXTRACTED]
  apps/gateway/src/index.ts → packages/contracts/src/index.ts
- `renew_policy` --references--> `Explicit confirmation`  [EXTRACTED]
  docs/voice_router_dataset/actions.json → docs/voice_router_dataset/README.ru.md

## Import Cycles
- None detected.

## Communities (33 total, 1 thin omitted)

### Community 0 - "gateway/src/index.ts / ai/src/index.ts"
Cohesion: 0.06
Nodes (37): account(), app, clientToken(), core(), limited(), locks, processTurn(), rate() (+29 more)

### Community 1 - "Store / .get()"
Cohesion: 0.12
Nodes (11): interval, CaseState, Message, Session, Staff, Trace, Engine, mask() (+3 more)

### Community 2 - "main.tsx / i18n/src/index.ts"
Cohesion: 0.09
Nodes (36): App(), api(), begin(), chooseCase(), Conversation(), enableLiveVoice(), end(), liveEvent() (+28 more)

### Community 3 - "VoiceClient / LiveVoiceClient"
Cohesion: 0.11
Nodes (7): Microphone, LiveVoiceClient, pcmBase64(), VadEvent, VoiceActivity, VoiceClient, VoiceEvent

### Community 4 - "web/package.json / dependencies"
Cohesion: 0.08
Nodes (23): dependencies, lucide-react, react, react-dom, @voice/contracts, @voice/i18n, devDependencies, vite (+15 more)

### Community 5 - "graph-docs.py / evaluate.py"
Cohesion: 0.10
Nodes (17): collections, Reference router evaluator for Voice Router. Usage: python evaluate.py…, graphify_analyze, graphify_build, graphify_cluster, graphify_detect, graphify_export, graphify_extract (+9 more)

### Community 6 - "dev_utterances.json / kb_lookup"
Cohesion: 0.14
Nodes (20): calc_accident_price, calc_property_price, create_callback, kb_lookup, Routing evaluation, SC07 Home insurance consultation, SC08 Accident insurance consultation, SC18 Documents for a claim (+12 more)

### Community 7 - "knowledge/src/index.ts / env.ts"
Cohesion: 0.12
Nodes (16): actions, AS_OF, dataDir, kb, queues, root, scenarios, slots (+8 more)

### Community 8 - "dialogs_sample.json / SC02 OGPO purchase"
Cohesion: 0.16
Nodes (18): calc_casco_price, calc_ogpo_price, get_bm_class, renew_policy, SC01 OGPO price quote, SC02 OGPO purchase, SC03 CASCO consultation and quote, SC27 Policy renewal (+10 more)

### Community 9 - "core/src/index.ts / engine.test.ts"
Cohesion: 0.17
Nodes (13): Decision, explicitConfirmation(), fingerprint(), isInjection(), mutationActions, normalizeSlots(), packages_core_src_index_policyfor, productByScenario (+5 more)

### Community 10 - "gateway/package.json / dependencies"
Cohesion: 0.11
Nodes (17): dependencies, @voice/ai, @voice/contracts, @voice/core, @voice/db, @voice/knowledge, @voice/ai, @voice/contracts (+9 more)

### Community 11 - "scenario-service/package.json / dependencies"
Cohesion: 0.11
Nodes (17): dependencies, @voice/ai, @voice/contracts, @voice/core, @voice/db, @voice/knowledge, @voice/ai, @voice/contracts (+9 more)

### Community 12 - "SC13 CASCO damage claim / SC12 Claim as victim under culprit's OGPO"
Cohesion: 0.28
Nodes (18): create_claim, get_policy, send_sms, transfer_to_operator, Operator handoff, Urgent scenarios first, SC11 Road accident just happened, SC12 Claim as victim under culprit's OGPO (+10 more)

### Community 13 - "contracts/src/index.ts / db/src/index.ts"
Cohesion: 0.15
Nodes (13): ActionEvent, CaseView, Language, languages, LiveOutputEvent, Pending, phoneSchema, Scenario (+5 more)

### Community 14 - "AppError / actions.ts"
Cohesion: 0.34
Nodes (14): AppError, activePolicy(), cascoPrice(), claimFor(), countryZone(), coverage(), newId(), number() (+6 more)

### Community 15 - "Explicit confirmation / find_client"
Cohesion: 0.26
Nodes (15): cancel_policy, find_client, update_contact, update_policy, Explicit confirmation, SC04 Add driver to motor policy, SC05 Change vehicle or plate in policy, SC24 DMS e-card issue (+7 more)

### Community 16 - "Grounded company facts / app_help"
Cohesion: 0.14
Nodes (14): app_help, bonus_malus, cancellation, claims, clinics, company, complaints, documents_available (+6 more)

### Community 17 - "ref_node_crypto / ref_node_fs"
Cohesion: 0.18
Nodes (10): ref_dotenv, ref_node_child_process, ref_node_crypto, ref_node_fs, ref_node_os, children, env, local (+2 more)

### Community 18 - "scenario-service/src/index.ts / createSessionSchema"
Cohesion: 0.15
Nodes (9): app, db, engine, server, token(), createSessionSchema, turnSchema, validateCatalog() (+1 more)

### Community 19 - "LLM scenario router / Voice Router specification"
Cohesion: 0.20
Nodes (12): 100-point scoring rubric, Single-command launch, Voice Router specification, Web microphone voice interaction, Dataset guide README.md, Dataset guide README.kz.md, Dialogue state, Russian Kazakh mixed speech (+4 more)

### Community 20 - "phone / SC26 Resend policy documents"
Cohesion: 0.21
Nodes (12): check_payment, get_policies, report_fraud, resend_documents, SC25 Check policy validity, SC26 Resend policy documents, SC30 Charged but policy not issued, SC38 Suspicious call or fraud report (+4 more)

### Community 21 - "core/package.json / dependencies"
Cohesion: 0.17
Nodes (11): dependencies, @voice/contracts, @voice/db, @voice/knowledge, exports, @voice/contracts, @voice/db, @voice/knowledge (+3 more)

### Community 22 - "db/package.json / dependencies"
Cohesion: 0.17
Nodes (11): dependencies, @voice/contracts, @voice/i18n, @voice/knowledge, exports, @voice/contracts, @voice/i18n, @voice/knowledge (+3 more)

### Community 23 - "SC21 Doctor appointment under DMS / SC20 Book vehicle inspection"
Cohesion: 0.25
Nodes (11): book_appointment, book_inspection, get_offices, list_clinics, SC20 Book vehicle inspection, SC21 Doctor appointment under DMS, SC23 Partner clinics list, SC33 Office addresses and hours (+3 more)

### Community 24 - "SC06 Travel insurance purchase / SC39 Certificate or document copy request"
Cohesion: 0.18
Nodes (11): calc_travel_price, create_policy, request_document, SC06 Travel insurance purchase, SC39 Certificate or document copy request, document_type, traveler_max_age, travelers_count (+3 more)

### Community 25 - "ai/package.json / dependencies"
Cohesion: 0.20
Nodes (9): dependencies, @voice/contracts, @voice/knowledge, exports, @voice/contracts, @voice/knowledge, name, private (+1 more)

### Community 26 - "SC22 DMS coverage check / SC10 Corporate insurance request"
Cohesion: 0.29
Nodes (8): check_coverage, SC09 Individual health insurance consultation, SC10 Corporate insurance request, SC22 DMS coverage check, company_name, email, employees_count, service_name

### Community 27 - "SC19 Disagreement with claim decision / SC35 Service complaint"
Cohesion: 0.36
Nodes (8): create_complaint, create_dispute, get_claim, SC17 Claim status, SC19 Disagreement with claim decision, SC35 Service complaint, claim_number, complaint_text

### Community 28 - "knowledge/package.json / dependencies"
Cohesion: 0.25
Nodes (7): dependencies, @voice/contracts, exports, @voice/contracts, name, private, type

### Community 29 - "contracts/package.json / dependencies"
Cohesion: 0.33
Nodes (5): dependencies, exports, name, private, type

### Community 30 - "i18n/package.json / dependencies"
Cohesion: 0.33
Nodes (5): dependencies, exports, name, private, type

### Community 31 - "Synthetic backend / Synthetic claims"
Cohesion: 0.40
Nodes (5): Synthetic claims, Synthetic clients, Synthetic payments, Synthetic policies, Synthetic backend

## Knowledge Gaps
- **205 isolated node(s):** `name`, `private`, `type`, `dev`, `start` (+200 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 247 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AppError` connect `AppError / actions.ts` to `gateway/src/index.ts / ai/src/index.ts`, `Store / .get()`, `core/src/index.ts / engine.test.ts`, `contracts/src/index.ts / db/src/index.ts`, `scenario-service/src/index.ts / createSessionSchema`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `Store` connect `Store / .get()` to `gateway/src/index.ts / ai/src/index.ts`, `core/src/index.ts / engine.test.ts`, `contracts/src/index.ts / db/src/index.ts`, `AppError / actions.ts`, `scenario-service/src/index.ts / createSessionSchema`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `VoiceClient` connect `VoiceClient / LiveVoiceClient` to `main.tsx / i18n/src/index.ts`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `name`, `private`, `type` to the rest of the system?**
  _205 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `gateway/src/index.ts / ai/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.059395801331285206 - nodes in this community are weakly interconnected._
- **Should `Store / .get()` be split into smaller, more focused modules?**
  _Cohesion score 0.12390572390572391 - nodes in this community are weakly interconnected._
- **Should `main.tsx / i18n/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09102564102564102 - nodes in this community are weakly interconnected._