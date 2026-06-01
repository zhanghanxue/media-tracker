# 07 — System Design

> A worked enterprise-AI design + a method you can apply to any prompt. The interviewer cares about *structured thinking and trade-offs*, not a perfect answer. Lead with my integration/backend strength; treat the model as one component.

---

## 0. The method (say this structure out loud — it scores points by itself)

1. **Clarify** — scope, scale, users, latency/accuracy targets, what "done" means. *Never start drawing before asking.*
2. **Define the contract** — inputs, outputs, APIs.
3. **Sketch components & data flow** — boxes and arrows.
4. **Walk one request end-to-end.**
5. **Scale it** — where it breaks, how to grow.
6. **Monitor & operate** — metrics, drift, failure modes.
7. **Trade-offs** — name what you chose *and what you gave up*.

> This is the same discipline as designing any backend system — I just add the ML-specific concerns (model serving, drift, human-in-the-loop).

---

## 1. Worked example: "Design an enterprise AI assistant that triages IT tickets and integrates with ServiceNow/Slack"

*(This is basically my project, scaled to enterprise — lean into that: "I've built a smaller version of exactly this.")*

### 1.1 Clarify (the questions I'd ask first)
- **Volume?** 100 tickets/day or 100k? (Drives sync-vs-async + batching.)
- **Latency target?** Real-time triage (seconds) vs batch overnight?
- **Accuracy bar + cost of error?** Misrouting an outage ticket vs a password reset.
- **Human-in-the-loop?** Auto-act, or suggest-and-confirm? (Enterprise usually wants suggest-first initially.)
- **Action scope?** Just classify+route, or also auto-resolve (reset password, create change)?
- **Data residency / PII?** Tickets contain sensitive data → on-prem vs cloud, which models are allowed.

### 1.2 Contract
- **In:** ticket created in ServiceNow (text, requester, category hints, attachments).
- **Out:** predicted category + priority written back to the record, auto-assignment to a group, Slack alert for urgent, suggested response/KB articles.

### 1.3 Components & data flow
```
ServiceNow (ticket created)
      │  outbound webhook (signed)
      ▼
┌─────────────────────────────────────────────────────────┐
│  Ingestion API  (FastAPI / gateway)                       │
│   - auth + signature verify                               │
│   - ack 200 fast, enqueue                                 │
└───────────────┬───────────────────────────────────────────┘
                ▼
          Message Queue (Kafka/SQS)        ← decouples spikes, enables retries
                │
                ▼
┌─────────────────────────────────────────────────────────┐
│  Triage Worker(s)  (scalable consumers)                   │
│   1. Classifier service  → category + priority + confidence│
│   2. RAG: vector search over KB/past tickets → context    │
│   3. LLM service → suggested response (grounded)          │
│   4. Decision/policy engine → urgent? auto-act? assign?   │
└───────────────┬───────────────────────────────────────────┘
                ├──▶ ServiceNow REST API  (write back category/priority/assignee)
                ├──▶ Slack webhook        (urgent alerts + interactive buttons)
                └──▶ Prediction log / feedback store (for monitoring + retraining)
```

### 1.4 One request end-to-end
ServiceNow fires a signed webhook on ticket-create → ingestion API verifies + acks `200` + enqueues → a worker pulls it → **classifier** returns category + priority + confidence → **vector search** pulls relevant KB articles + similar past tickets → **LLM** drafts a grounded suggested response → **policy engine** decides: high confidence + non-destructive → auto-assign + write back; urgent → Slack alert with Escalate/Resolve buttons; low confidence → route to human queue → everything logged for monitoring.

### 1.5 Scale
- **Stateless workers** behind the queue → horizontal autoscale on queue depth (K8s HPA).
- **Classifier**: cheap/fast, replicate freely; **dynamic batching** at high volume.
- **LLM**: the cost/latency bottleneck → cache repeated prompts, cap tokens, use a smaller model where possible, self-host with vLLM/TGI at scale.
- **Vector DB**: pgvector to start; managed (Pinecone/Qdrant) at large scale.
- **Queue** absorbs spikes so ServiceNow never blocks on us.

### 1.6 Monitor & operate
- Ops: latency, error rate, queue depth, cost/ticket.
- ML: prediction & confidence distributions, **data drift** on incoming ticket text, **live accuracy via feedback** (did a human reassign the auto-routed ticket? that's ground truth).
- Guardrails: confidence threshold for auto-action; **human-in-the-loop below threshold**; full audit log of every automated action (enterprise compliance).

### 1.7 Trade-offs to name out loud
- **Auto-act vs suggest-only** — start suggest-only to build trust + gather labels, raise autonomy as accuracy proves out.
- **Classifier + LLM (my hybrid) vs LLM-only** — hybrid is cheaper, more accurate on fixed categories, and gives a thresholdable confidence; LLM-only is more flexible for novel/long-tail tickets. I'd justify the split exactly as in my real project.
- **Sync vs queued** — queued adds latency but gives resilience, retries, and spike absorption — right for enterprise volume.
- **Build vs buy** — could use Glean/Copilot for the RAG layer instead of building it.

---

## 2. Other likely prompts (outline answers)

### 2.1 "Design a RAG system to answer employee questions over internal docs (à la Glean)"
- **Clarify:** corpus size, update frequency, access control (per-user doc permissions!), latency, citation requirement.
- **Index pipeline:** connectors (Confluence/SharePoint/Drive) → chunk → embed → vector DB, with **per-document ACLs stored alongside vectors**.
- **Query pipeline:** embed question → vector search **filtered by the user's permissions** → rerank → stuff top-k into LLM → answer **with citations**.
- **Hard parts:** permission-aware retrieval (never leak a doc the user can't see), keeping the index fresh (incremental re-indexing on doc change), chunking strategy, and evaluating answer quality (groundedness, not just relevance).
- **Monitor:** retrieval hit rate, "no good answer" rate, thumbs-up/down feedback, hallucination/groundedness checks.

### 2.2 "Design a model-serving platform that hosts many models for many teams"
- **Clarify:** how many models, traffic shape, latency SLAs, CPU vs GPU, self-serve?
- **Components:** model registry (versioned artifacts) → container build → inference servers (Triton/vLLM/TGI) → API gateway (auth, rate limit, routing by model+version) → autoscaler → observability.
- **Key ideas:** standardized model packaging, A/B + canary + shadow deployment, per-model autoscaling, GPU sharing/batching for utilization, multi-tenancy isolation, **eval gate in CI before a model goes live**.
- **Trade-offs:** shared GPU pool (cost-efficient, noisy-neighbour risk) vs dedicated; sync API vs async batch endpoints.

### 2.3 "Design real-time content moderation / classification at scale"
- **Clarify:** throughput (events/sec), latency budget, precision-vs-recall priority, human review needs.
- **Flow:** event stream (Kafka) → fast classifier (batched) → high-confidence auto-action, **uncertain → human review queue** → feedback labels back into retraining.
- **Key ideas:** tiered models (cheap fast filter → expensive model only on uncertain cases), backpressure handling, **active learning** (route low-confidence items to humans to generate the most valuable training labels), shadow-deploy new models before promoting.

---

## 3. Likely interview questions + model answers

**Q1. "Design an AI ticket-triage assistant. Where do you start?"**
> "With questions, not architecture. Volume — a hundred tickets a day or a hundred thousand changes everything. Latency target. The cost of a wrong routing. Whether it auto-acts or suggests and a human confirms — enterprises usually want suggest-first to build trust. And data sensitivity, since tickets have PII. Once I know that, my shape is: ServiceNow fires a signed webhook on ticket-create, an ingestion API acks fast and enqueues, scalable workers classify the ticket, retrieve relevant KB articles, draft a grounded response with an LLM, and a policy engine decides whether to auto-assign, alert Slack, or route to a human — logging everything for monitoring and retraining. I've actually built a smaller version of this, so I'd anchor on that and scale it with a queue and stateless workers."

**Q2. "Why put a queue in the middle?"**
> "Decoupling and resilience. ServiceNow shouldn't block on my processing or fail if I'm slow — it fires the event and moves on. The queue absorbs traffic spikes, lets me autoscale workers on queue depth, and gives me retries and a dead-letter path when a downstream like the LLM is temporarily down. The cost is added latency and operational complexity, which is the right trade for enterprise volume but overkill for a low-traffic tool."

**Q3. "Where does this break at 100x scale, and what do you do?"**
> "The LLM is the first bottleneck — it's the slowest and most expensive call. I'd cache repeated prompts, cap output tokens, push more work onto the cheap classifier, and self-host with a batching server like vLLM. The classifier scales easily with replicas and dynamic batching. The vector DB might need to move from pgvector to a managed store. And the queue plus stateless workers means I scale horizontally on queue depth rather than vertically. I'd watch cost-per-ticket as closely as latency, because at 100x, LLM spend is the thing that surprises you."

**Q4. "How do you keep it trustworthy in an enterprise?"**
> "Human-in-the-loop gated by confidence — auto-act only above a threshold and on non-destructive actions, route everything else to a human. A full audit log of every automated decision for compliance. Grounding LLM responses with RAG plus citations so they're verifiable, not improvised. And a feedback loop — when a human overrides the system, that's both a safety net and a training label. You earn autonomy gradually: start suggest-only, prove accuracy, then raise the automation bar."

**If I'm asked to go deeper than I can** (e.g. exact Kafka partitioning, consensus):
> "I'd reason from the requirement rather than guess specifics — here's the property I need [ordering / throughput / durability] and the class of solution. I haven't tuned that exact system in production, so I'd validate the details against real numbers." Honest + still shows reasoning.

---

## 4. Reusable checklist (memorize)

**Clarify → Contract → Components → Walk one request → Scale → Monitor → Trade-offs.**

ML-specific things to *always* mention: **confidence thresholds, human-in-the-loop, feedback loop, drift monitoring, cost-per-request, model versioning, graceful degradation.** Dropping these signals you think about *production AI*, not just APIs.
