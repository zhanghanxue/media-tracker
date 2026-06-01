# 06 — API & SaaS Integration

> The JD lists Slack, ServiceNow, Workday, Glean, Copilot, etc. This is where my 6 years actually shine — REST, auth, webhooks, orchestrating across tools. Frame it as: *"I've been doing enterprise integration for years; the AI project just adds a model as one more service in the workflow."*

---

## 1. REST API design (my bread and butter)

**REST** = resources addressed by URLs, manipulated with HTTP verbs, stateless requests, standard status codes.

- **Verbs:** `GET` (read, safe/idempotent), `POST` (create/action), `PUT` (replace, idempotent), `PATCH` (partial update), `DELETE` (idempotent).
- **Status codes I actually use:** `200` OK, `400` bad request (my `/predict` rejects empty text), `404`, `429` rate limited, `500` server error, `503` unavailable.
- **Idempotency** — same request twice = same effect. Critical for retries; `POST` isn't idempotent unless you add an idempotency key.
- **Versioning** — `/v1/predict` so you can evolve without breaking clients.
- **Typed contracts** — request/response schemas as the contract.

**In my project:** `/predict`, `/agent/predict`, `/health`, `/agent/health`, `/agent/metrics`. I use **Pydantic models** (`PredictionRequest/Response`, `AgentRequest/Response`) as typed DTOs, return proper status codes, and validate input (`main.py:56` rejects empty/short text with `400`). FastAPI auto-generates **OpenAPI/Swagger docs** at `/docs`.

> **Spring analogy:** Pydantic = Java records + Bean Validation; FastAPI's auto OpenAPI = springdoc/Swagger; `HTTPException` = `@ResponseStatus`/`ResponseEntity`. This is the same REST discipline I've shipped for years — just in Python.

---

## 2. Webhooks — event-driven integration

A **webhook** is a **reverse API call**: instead of you polling a service, the service **POSTs to your URL when an event happens**. "Don't call us, we'll call you."

- **Polling** = you repeatedly ask "anything new?" (wasteful, laggy). **Webhook** = they push the event instantly (efficient, real-time).
- **In my project:** the **Slack alert is an outbound webhook** — `slack_tool.send_alert()` POSTs a Block Kit JSON message to a Slack **Incoming Webhook URL** (`slack_tool.py:109`). For urgent tickets the system pushes a formatted alert into a Slack channel in real time.
- **Inbound direction (how I'd extend it):** ServiceNow could fire a webhook to my `/agent/predict` whenever a ticket is created — event-driven triage instead of manual submission.

**Webhook engineering concerns (know these):**
- **Verify authenticity** — validate a signature (e.g. Slack's signing secret / HMAC) so attackers can't forge events.
- **Respond fast, process async** — ack `200` immediately, do the work in a queue (webhook senders retry/timeout aggressively).
- **Idempotency** — webhooks get re-delivered; dedupe on event ID.
- **Retries & dead-letter** — handle failures without losing events.

> **ServiceNow analogy:** webhooks are exactly ServiceNow **outbound REST messages / business rules** firing on a record event — I've wired these up. The triage flow is "on ticket create → call scoring service → update record / notify," which is bread-and-butter ServiceNow integration.

---

## 3. Auth — the part interviewers probe

| Mechanism | What it is | Use |
|---|---|---|
| **API key** | Static secret in a header | Service-to-service, simple |
| **Bearer token / OAuth2** | Short-lived token from an auth server | User-delegated access (Slack, Workday, Google) |
| **JWT** | Signed, self-contained token with claims | Stateless auth across services |
| **HMAC signature** | Sign the payload with a shared secret | Webhook verification |
| **mTLS** | Mutual cert auth | High-security service-to-service |

- **In my project:** I authenticate to the **HF Inference API with a Bearer token** (`HF_TOKEN`, `llm_service.py:16`). **Honest gap: my own endpoints have NO auth** — anyone who finds the Space can call `/predict` and `/agent/predict`, which costs me LLM money. In production I'd put an API key or OAuth2 in front and rate-limit per client.
- **OAuth2** is the enterprise standard for the SaaS tools in the JD — Slack, Workday, Google all use OAuth2 authorization-code flow for user-delegated access. **Never put secrets in code/images** — runtime env or a secrets manager (my Dockerfile currently violates this; see fix-list).

> **Spring analogy:** this maps directly to Spring Security — API keys/JWT filters, OAuth2 client/resource-server config, method-level authorization. Auth is a solved problem in my Spring experience; the gap in my AI project is that I skipped it for a $0 demo, and I know exactly how to close it.

---

## 4. Rate limits

- **Why:** protect the service from overload, control cost, ensure fairness.
- **Algorithms:** **token bucket** (allow bursts up to a cap, refill over time — most common), **fixed/sliding window**, **leaky bucket**.
- **Signaling:** return **`429 Too Many Requests`** + a **`Retry-After`** header; clients back off (ideally exponential backoff + jitter).
- **In my project:** I'm on the *receiving* end — the HF Inference API rate-limits *me* with `429`, and `llm_service.py:61` handles it by sleeping and retrying. I also have a crude **cost-based limiter** — a `$0.10` free-tier budget with a 90% warning. I do **not** rate-limit my *own* callers (gap — pairs with the no-auth gap).

> **Honest improvement:** I'd add per-client rate limiting (token bucket) + auth so a single caller can't run up my LLM bill — exactly the kind of guardrail I'd build for any public endpoint.

---

## 5. Orchestrating workflows across tools (the JD's core ask)

Enterprise AI assistants live or die on **integration** — stitching a model into the systems people already use (Slack, ServiceNow, Workday, Glean). This is precisely my background.

**My project as a micro-example of orchestration:**
```
ticket → [classify: model service] → [decide: LLM] → [act: Slack webhook]
```
That's a 3-tool workflow with branching logic (urgent vs not), a deterministic fallback, and structured I/O between steps — `react_agent.py` is the orchestrator. Each tool (`classification_tool`, `llm_service`, `slack_tool`) is a clean adapter with a uniform `{success, ...}` response shape, so the orchestrator can reason about failures uniformly.

**How I'd extend it to the JD's tools:**
- **ServiceNow** — inbound webhook on ticket-create → triage → write the predicted category/priority back onto the record via ServiceNow's REST API; auto-assign to the right group. *(This is literally my day job pattern.)*
- **Slack** — already integrated for alerts; add a slash command (`/triage`) or interactive buttons ("Escalate" / "Resolve") via Slack's Events/Interactivity API.
- **Workday** — for HR-type requests, look up employee context via Workday's API to enrich the prompt.
- **Glean / Copilot** — enterprise search/RAG over internal docs to ground responses (ties to file 04's RAG plan).

**Integration patterns that matter (and that I know):**
- **Adapter per external system** — isolate each SaaS's quirks behind a uniform interface (my `*_tool` classes do this).
- **Idempotency + retries + timeouts** on every external call (I have timeouts + retries on the LLM and Slack calls).
- **Graceful degradation** — one tool down ≠ whole workflow down (my LLM-failure fallback).
- **Async / queue-based** for slow or unreliable downstreams — ack fast, process via a queue (SQS/Kafka/Celery).
- **Correlation IDs** for tracing a request across systems.

> **ServiceNow/Spring framing:** "I've spent years orchestrating workflows across enterprise systems — ServiceNow integrations, REST APIs between services, event-driven business rules. An AI assistant is the same discipline with a model as one more service in the chain. The model is the novel part; the *integration* — auth, webhooks, retries, idempotency, writing back to systems of record — is exactly what I already do."

---

## 6. Likely interview questions + model answers

**Q1. "How would you integrate your triage system with ServiceNow?"**
> "Event-driven. I'd register an outbound webhook or business rule in ServiceNow that fires on ticket creation and POSTs the ticket to my `/agent/predict` endpoint. The service classifies intent, decides urgency, and writes the predicted category and priority back onto the ServiceNow record via its REST API, then auto-assigns to the right group. Urgent tickets also fire a Slack alert. I'd secure the webhook with signature verification, ack fast and process async so I don't block ServiceNow, and dedupe on the record's sys_id for idempotency since webhooks get redelivered. This is essentially the integration pattern I've built many times in ServiceNow — the model is just a new service in the chain."

**Q2. "What's a webhook, and where do you use one?"**
> "A webhook is a reverse API call — instead of polling, the source service POSTs to my URL when an event happens, so it's real-time and efficient. In my project the Slack alert is an outbound webhook: for urgent tickets I POST a formatted Block Kit message to a Slack incoming webhook. The key engineering concerns are verifying the sender's signature so events can't be forged, responding fast and doing work async because senders retry aggressively, and deduping on event ID since delivery isn't exactly-once."

**Q3. "How do you secure these APIs?"**
> "Layered. Service-to-service I'd use API keys or OAuth2 client credentials; user-delegated access to SaaS like Slack or Workday uses OAuth2 authorization-code flow; webhooks get HMAC signature verification. Secrets live in a runtime secrets manager or env vars, never in code or image layers. I'll be honest that my demo's own endpoints currently have no auth — it's a $0 public Space — but I know exactly how to close that: an auth layer plus per-client rate limiting so nobody can run up the LLM bill. Auth is well-trodden ground from my Spring Security work."

**Q4. "How do you handle a flaky third-party API?"**
> "Timeouts on every call, retries with exponential backoff and jitter, and respect for 429/503 with Retry-After — which I actually do for the Hugging Face inference API; it returns 503 on cold start and 429 on rate limits and I back off and retry. Beyond that: a circuit breaker so I stop hammering a dead service, graceful degradation so one tool failing doesn't kill the workflow — my agent falls back to deterministic logic if the LLM is down — and for truly unreliable downstreams, a queue so I can ack fast and process with retries out of band."

**Q5. "How do you orchestrate a multi-tool workflow reliably?"**
> "Each external system gets an adapter with a uniform response shape, so the orchestrator handles success and failure consistently — that's what my tool classes do. Every external call has a timeout and retry. The workflow degrades gracefully — a single tool being down falls back rather than failing the whole request. For slow or unreliable steps I'd go async with a queue and ack the caller immediately. And I'd thread a correlation ID through every call so I can trace one logical request across all the systems it touches. It's the same reliability discipline as any distributed backend."

**If I'm asked about a specific tool I haven't used** (Glean, Workday API specifics):
> "I haven't integrated that one specifically, but every SaaS integration is the same shape — auth (usually OAuth2), a REST or webhook contract, pagination, rate limits, idempotency, and error handling. I'd read their API docs and wrap them behind an adapter like I do for Slack and the model service. The pattern transfers; the details are a docs-read away."

---

## 7. Terms to define in one line

- **REST** — resources + HTTP verbs + status codes, stateless.
- **Idempotency** — same request repeated = same effect (safe to retry).
- **Webhook** — service pushes an event to your URL instead of you polling.
- **OAuth2** — token-based delegated auth; enterprise SaaS standard.
- **JWT** — signed self-contained token with claims.
- **HMAC signature** — verify a webhook's authenticity with a shared secret.
- **Rate limit / token bucket** — cap request rate; allow bursts, signal with 429.
- **Exponential backoff + jitter** — retry strategy that spreads out load.
- **Circuit breaker** — stop calling a failing service to let it recover.
- **Adapter** — uniform wrapper isolating an external system's quirks.
- **Correlation ID** — trace one request across multiple systems.
