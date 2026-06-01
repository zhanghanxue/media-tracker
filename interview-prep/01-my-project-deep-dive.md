# 01 — My Project Deep Dive

> The "tell me about an AI system you built" file. This is your highest-value asset in the interview. Know it cold.
> **Last-glance companion:** [`00-CHEAT-SHEET.md`](00-CHEAT-SHEET.md) — pitch, 5 killer lines, numbers, and the concrete bug/security fix-list condensed to one page.

---

## 0. One-paragraph honest framing (read this first)

I'm a **backend/infrastructure engineer** (6 yrs Java/Spring Boot + ServiceNow) who built an **end-to-end AI system** as my hands-on transition into AI engineering. The interesting part for *this* role isn't the ML depth — it's that I took a fine-tuned model and wrapped it in **production engineering**: a typed API, containerization, CI/CD, a live deployment, cost tracking, graceful degradation, and a tool-using agent that integrates with Slack. That's exactly "software engineering *for* AI."

**Do not oversell the ML.** I fine-tuned one classifier and called a hosted LLM. The story is the *system around the model*, which is where my Spring Boot/ServiceNow background actually transfers.

---

## 1. What the system does (the 30-second pitch)

**Support Ticket Triage Agent.** A user submits a free-text support ticket ("URGENT: my card was charged twice"). The system:

1. **Classifies** the ticket into one of **77 banking intents** using a fine-tuned **DistilBERT** model.
2. **Applies a business rule** to decide if it's urgent (certain intents + confidence > 0.7).
3. **Asks an LLM (Mistral-7B-Instruct)** to reason about what action to take and draft a customer-facing response.
4. **Acts**: for urgent tickets, fires a **Slack alert** to the human team; otherwise returns a normal acknowledgement.
5. Returns intent, confidence, urgency flag, escalation status, processing time, and **estimated LLM cost**.

Deployed live on **Hugging Face Spaces** behind a **FastAPI** service, containerized with **Docker**, shipped via a **GitHub Actions CI/CD pipeline**. Built on a **$0 budget on a Chromebook** (Colab for training, HF Spaces for hosting).

---

## 2. End-to-end architecture & request flow

```
                          ┌─────────────────────────────────────────────┐
                          │   FastAPI service (app/main.py)              │
  User ──HTTP──▶ Gradio   │                                              │
   ticket        UI  ──▶  │   POST /agent/predict                        │
                          │        │                                     │
                          │        ▼                                     │
                          │   ReActAgent.process()  (react_agent.py)     │
                          │        │                                     │
                          │   1.   ├─▶ classification_tool.classify()    │
                          │        │      └─ HTTP POST to /predict ───┐   │
                          │        │                                  │   │
                          │   /predict ◀─────────────────────────────┘   │
                          │        │   predict_intent()  (prediction.py)  │
                          │        │   transformers pipeline →            │
                          │        │   DistilBERT (banking77-weighted)    │
                          │        │   returns (intent, confidence)       │
                          │        │                                      │
                          │   2.   ├─▶ business rule: is_urgent?          │
                          │   3.   ├─▶ llm_service.generate()  ──HTTP──▶  │ ──▶ HF Inference API
                          │        │      (Mistral-7B-Instruct)           │     (Mistral-7B)
                          │        │      parse JSON decision             │
                          │   4.   ├─▶ if urgent: slack_tool.send_alert() │ ──▶ Slack webhook
                          │        │                                      │     (or mock)
                          │   5.   └─▶ return structured response         │
                          └─────────────────────────────────────────────┘
```

**Concrete request walk-through** (`react_agent.py:85` `process()`):

1. **Classify first, always.** `classification_tool.classify(text)` does an **HTTP POST to the service's own `/predict` endpoint**. That endpoint (`main.py:54`) calls `predict_intent()` (`prediction.py:33`), which runs a Hugging Face `transformers` **`pipeline("text-classification", model="zhanghanxue/banking77-weighted-classifier")`**. The pipeline handles tokenization → inference → softmax and returns `{label, score}`.
2. **Urgency is a business rule, not a model output.** `classification_tool.py:38`: `is_urgent = intent in settings.URGENT_INTENTS and confidence > 0.7`.
3. **LLM reasoning step.** `llm_service.generate(prompt)` POSTs to the HF Inference API for **Mistral-7B-Instruct-v0.1**, asking it to return a JSON decision (`{thought, action, action_input}`). The agent parses the JSON with a regex (`_parse_agent_response`).
4. **Act on the decision.** If `action == "slack_alert"` *and* it's urgent → `slack_tool.send_alert()` posts a Block Kit message to a Slack webhook (or logs a "mock" alert if no webhook is configured).
5. **Return** a typed `AgentResponse` with intent, confidence, `is_urgent`, `escalated`, `processing_time`, and `llm_cost`.

> **Spring analogy:** `/agent/predict` is a `@RestController` endpoint, `ReActAgent` is a `@Service` orchestrating two downstream clients (`classification_tool`, `llm_service`) and a notifier (`slack_tool`), `PredictionRequest/Response` are your typed DTOs (Pydantic = Java records + Bean Validation), and the HF Inference API is an external dependency you call with a `RestTemplate`/`WebClient`.

---

## 3. The two models — what each one is and why both exist

| | **DistilBERT classifier** | **Mistral-7B-Instruct** |
|---|---|---|
| **Role** | Fast, cheap, deterministic intent classification | Reasoning + drafting a human-style response |
| **Where it runs** | Loaded *in-process* via `transformers` pipeline (CPU) | **Remote** — HF Inference API (I don't host it) |
| **I trained it?** | Yes — fine-tuned on banking77 | No — used off-the-shelf, instruction-tuned |
| **Output** | 1 of 77 labels + confidence score | Free text (coerced to JSON) |
| **Cost** | Free (runs locally in the container) | Metered (~GPU-seconds; I track it) |

**Why two models?** This is a deliberate **right-tool-for-the-job** split and a strong talking point:
- The classifier is a **discriminative** model — it's small (67M params), fast, and gives a **stable confidence score I can threshold on** (a raw softmax probability — *not* truly calibrated, but consistent and usable; see §6). Perfect for the structured "which of 77 buckets" decision.
- The LLM is a **generative** model — good at fluent language and flexible reasoning, but slow, costly, non-deterministic, and can hallucinate. I use it only for the open-ended "what should I say / do" part, *not* for the classification it would be worse and pricier at.

> If asked "why not just use the LLM for everything?" → *"A 7B LLM would classify worse than my fine-tuned classifier on these 77 domain-specific intents, cost money per call, and give me no stable confidence score to gate on. I push the deterministic decision to the cheap specialist model and reserve the LLM for the part that genuinely needs language generation."*

---

## 4. Key design decisions & trade-offs

### 4.1 Fine-tuned DistilBERT over a general LLM for classification
- **Why:** Cheaper, faster, deterministic, gives a thresholdable confidence. DistilBERT is ~40% smaller / ~60% faster than BERT with ~97% of the performance.
- **Trade-off:** Fixed label set — adding a new intent means re-training. An LLM could classify zero-shot into new categories. I accepted that because the 77 banking intents are stable.

### 4.2 Class weighting for imbalance
- The banking77 training set is **imbalanced** (some intents far rarer than others). I used `sklearn.compute_class_weight("balanced")` and a **custom `WeightedTrainer`** that injects those weights into `CrossEntropyLoss`, so rare classes aren't ignored.
- **Trade-off:** Weighting can hurt majority-class precision slightly to lift minority recall. I judged that acceptable because a missed *fraud* or *stolen card* ticket is worse than a slightly noisier common one.

### 4.3 Urgency as a business rule, not a model prediction
- The model predicts **intent**; urgency is `intent ∈ URGENT_INTENTS and confidence > 0.7` (`classification_tool.py:38`).
- **Why this is good engineering:** business policy ("what counts as urgent") changes more often than the model. Keeping it as config (`settings.URGENT_INTENTS`) means I can re-prioritize without re-training. **This is exactly the Spring pattern of keeping policy out of the core and in config.**
- **Honesty note:** the README says "predicts urgency with 92% accuracy" — that's loose wording. The model predicts *intent*; urgency is derived. I'll say that plainly if asked.

### 4.4 The agent calls back into its own `/predict` over HTTP
- `classification_tool` does an HTTP POST to the same service's `/predict` rather than calling `predict_intent()` directly in-process.
- **Trade-off:** simpler to reason about as a "tool the agent calls," and it would let me split the classifier into its own service later — but it adds a network hop and a localhost dependency. In a redesign I'd call the function directly in-process (or genuinely separate the services). **Good thing to volunteer as "what I'd improve."**

### 4.5 Cost tracking & free-tier guardrail
- `llm_service` estimates cost as `response_time_s × COST_PER_SECOND_GPU`, accumulates `total_cost`, warns at 90% of a `$0.10` free-tier budget, and exposes `/agent/metrics`.
- **Why it matters for this role:** LLM calls cost real money in production. Surfacing cost-per-request and a budget guardrail is the kind of **operational instrumentation** an AI infra engineer is expected to build. (It's an *estimate*, not billing-accurate — I'll say so.)

### 4.6 Graceful degradation everywhere
- LLM call fails/times out → **deterministic fallback**: if urgent, still fire the Slack alert; else return a safe canned response (`react_agent.py:151`).
- No Slack webhook configured → **mock mode** logs the alert instead of crashing (`slack_tool.py:95`).
- 503 (model cold-start) / 429 (rate limit) from HF → **retry with backoff** (`llm_service.py:55`).
- **This is the strongest "I think like a production engineer" signal in the codebase.** The system stays useful even when its fanciest component (the LLM) is down.

### 4.7 Deployment: Docker + HF Spaces + GitHub Actions
- **Dockerfile**: `python:3.11-slim`, requirements copied first for layer caching, runs `uvicorn`.
- **CI/CD** (`.github/workflows/cicd.yml`): on push to `main` → build image → push to GHCR → **spin up the container and curl `/health`, `/predict`, `/agent/health` as smoke tests** → if green, deploy to HF Spaces via `git push --force`.
- **Why it matters:** this is real CI/CD for an ML service — it actually *tests the running container* before deploying, not just unit tests.

---

## 5. Results (use the REAL numbers)

From the training notebook's evaluation on the held-out test set (3,080 examples, 40 per class):

- **Accuracy: 86.7%** (`eval_accuracy: 0.8672`)
- **Weighted F1: 86.6%** (`eval_f1: 0.8664`)
- **Macro avg F1: 0.87**, precision 0.88, recall 0.87
- Trained **3 epochs**, lr `2e-5`, batch size 16, ~7m45s on a Colab GPU.

> ⚠️ **Discrepancy to own:** the README badge says "92% accuracy / 86% F1." My notebook shows **~87% accuracy / ~87% F1**. If numbers come up, quote the notebook figures and say the README headline was optimistic — *interviewers respect the person who corrects their own marketing copy.*

**Per-class color:** strong classes (`apple_pay_or_google_pay`, `passcode_forgotten`, `verify_top_up` ≈ 1.00 F1); weak ones (`why_verify_identity` 0.48 F1, `topping_up_by_card` 0.68) — these are **semantically overlapping intents** the model confuses, which is the honest, expected failure mode and a great thing to discuss.

---

## 6. Limitations & what I'd improve (have these ready — they're often the best part)

> **Two non-overlapping lists — each item lives in exactly one place:**
> - **Concrete code defects** (real bugs, security smells, specific design issues, with line refs) → the single source of truth is the fix-list in [`00-CHEAT-SHEET.md`](00-CHEAT-SHEET.md#-what-would-you-improve--lead-with-this-fix-list). **Lead with that** when asked "what would you improve?"
> - **Architectural limitations** (what the *system* fundamentally can't do — not bugs) → the bullets below.

**Known limitations (architectural — not code defects; for those see the `00` fix-list):**
- **Fixed 77-label taxonomy** — can't handle a genuinely new intent without retraining.
- **No real monitoring/drift detection** — I track cost, but not input drift or live accuracy, and there's no feedback loop capturing whether triage was *correct*.
- **Classifier confidence isn't calibrated** — a 0.7 threshold is a guess, not a calibrated probability. "Balance" queries returned very low confidence (0.13) in testing.
- **Cost is estimated** from latency, not actual billing.
- **Single replica, lazy model load, no batching** → the first request after cold start is slow and throughput doesn't scale per-replica.

**What I'd do next (prioritized):**
1. **Add a feedback loop + monitoring** — log predictions, let agents correct labels, track live F1 and input drift. Without this you can't know the model is degrading.
2. **RAG for the response generation** — ground the LLM's reply in a knowledge base of real support articles so it stops improvising answers (see file 04).
3. **Function-calling / structured output** instead of regex JSON parsing.
4. **Calibrate confidence** (temperature scaling) so the 0.7 threshold means something.
5. **Separate the classifier into its own service** (or call it in-process) and add batching + async for throughput.
6. **Real evaluation harness in CI** — currently CI smoke-tests endpoints but doesn't gate on model metrics.

---

## 7. Likely interview questions + model answers (in my voice)

**Q1. "Walk me through an AI system you've built, end to end."**
> "I built a support-ticket triage agent. A ticket comes in as free text; a fine-tuned DistilBERT classifier sorts it into one of 77 banking intents with a confidence score. A business rule flags urgent intents above a confidence threshold. Then a hosted Mistral-7B LLM reasons about the right action and drafts a reply, and for urgent tickets the system fires a Slack alert to the human team. It's a FastAPI service, containerized with Docker, deployed to Hugging Face Spaces through a GitHub Actions pipeline that builds the image, smoke-tests the running container, and deploys on green. My background is backend engineering, so the part I'm proudest of isn't the model — it's the system around it: typed APIs, graceful degradation when the LLM is down, cost tracking with a budget guardrail, and automated deployment."

**Q2. "Why two models instead of one LLM?"**
> "Right tool for the job. The classifier is small, fast, free to run in-process, deterministic, and gives me a confidence score I can threshold on — ideal for a fixed 77-class decision. A general LLM would classify those domain intents worse, cost money per call, and give me no stable confidence. So I use the cheap specialist for the structured decision and reserve the LLM for the open-ended language generation, which is the only part that genuinely needs it."

**Q3. "What happens when the LLM call fails?"**
> "The system degrades gracefully instead of erroring. If the LLM times out or errors, I fall back to deterministic logic: if the ticket is urgent I still fire the Slack alert, otherwise I return a safe canned acknowledgement. I also handle HF's 503 model-cold-start and 429 rate-limit responses with backoff and retry. The design principle is that the most fragile component — the remote LLM — should never be a single point of failure for triage."

**Q4. "How accurate is it, and how do you know?"**
> "On a held-out test set of 3,080 examples — 40 per class — it gets about 87% accuracy and 0.87 weighted F1. I evaluated with a full per-class precision/recall/F1 report, not just accuracy, because the data's imbalanced. The strong classes are near-perfect; the weak ones are semantically overlapping intents like the different identity-verification categories, which the model understandably confuses. One honest caveat: my README headline says 92% — that was optimistic; the notebook number is 87%, and that's the one I trust."

**Q5. "You called it a ReAct agent — what makes it an agent?"**
> "I'll be precise: it's a tool-using orchestration, but it's not a true multi-step ReAct loop. It always classifies first, makes a single LLM call to decide an action, and then executes that action — Slack alert, respond, or classify — with a deterministic fallback. It has the agent ingredients — tools, an LLM making a decision, actions on the world — but it doesn't iterate over observations. If I were claiming a real ReAct loop I'd need the model to observe each tool result and decide the next step in a loop, which is on my improvement list."

**If I'm asked something I don't know** (e.g. deep training internals, distributed serving):
> "I haven't gone deep on that — my hands-on AI work is one fine-tuned classifier plus a hosted LLM, and my real depth is backend systems and integration. Here's how I'd reason about it from first principles…" then connect to something you *do* know (HTTP, retries, caching, queues, observability). **Bridging from backend fundamentals beats bluffing ML.**

---

## 8. Numbers & names to memorize

- **DistilBERT**: ~67M params, ~40% smaller / ~60% faster than BERT, ~97% of performance.
- **banking77**: 77 intent classes, 10,003 train / 3,080 test, 40 test examples per class.
- **My results**: 86.7% accuracy, 0.866 weighted F1, 3 epochs, lr 2e-5, batch 16.
- **Mistral-7B-Instruct-v0.1** via HF Inference API; temperature 0.7, max 200 new tokens.
- **Model on HF Hub**: `zhanghanxue/banking77-weighted-classifier`.
- **Stack**: FastAPI 0.121, transformers 4.57, torch 2.9 (CPU), Pydantic 2, Docker (python:3.11-slim), GitHub Actions → GHCR → HF Spaces, Gradio UI.
- **Free-tier guardrail**: $0.10/mo budget, cost ≈ GPU-seconds.
