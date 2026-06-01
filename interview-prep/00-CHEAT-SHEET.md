# 00 — One-Page Cheat Sheet
*(last glance before the room)*

> Quick-reference. For depth, see [`01-my-project-deep-dive.md`](01-my-project-deep-dive.md).

---

## ⏱️ 30-second pitch

Support-ticket triage agent:

> Free-text ticket → fine-tuned **DistilBERT** sorts it into 1 of **77 banking intents** + confidence → **business rule** flags urgent (`intent ∈ URGENT_INTENTS & conf > 0.7`) → **Mistral-7B-Instruct** (hosted, HF Inference API) reasons about the action + drafts a reply → urgent tickets fire a **Slack** alert.

**Stack one-liner:** FastAPI service · Docker · GitHub Actions → GHCR → HF Spaces · $0 budget.

> *"I'm a backend engineer; the story is the system around the model, not the ML depth."*

---

## 🎯 The 5 killer lines (say these verbatim)

1. **Two models** — *"The classifier gives a stable softmax score over a fixed label set, deterministically — raw, not truly calibrated, which I'll own — while the LLM is an enhancement layer that's never load-bearing for the critical path."*
2. **DistilBERT** — *"Teacher-student distillation — ~40% smaller, ~60% faster, ~97% of BERT's GLUE performance — the right latency trade for CPU serving."*
3. **Async bug** — *"A blocking call in an async endpoint starves the single event-loop thread."*
4. **Thresholds** — *"I lowered the bar for fraud because a missed positive costs far more than a false alarm — trading precision for recall, with alert-fatigue as the tuning constraint."*
5. **Closing pitch** — *"Production-shaped pipeline, demo-grade verification — and I know which half to harden first."*

---

## 🔢 Numbers & names (memorize)

| What | Value |
|------|-------|
| **Results** (REAL, from notebook) | 86.7% accuracy · 0.866 weighted F1 · macro-F1 0.87 |
| Training run | 3 epochs · lr 2e-5 · batch 16 · ~7m45s on Colab GPU |
| Test set | 3,080 examples · 40/class |
| **DistilBERT** | ~67M params |
| **banking77** | 77 classes · 10,003 train / 3,080 test |
| LLM | **Mistral-7B-Instruct-v0.1** · temp 0.7 · max 200 new tokens |
| Model repo | `zhanghanxue/banking77-weighted-classifier` |
| Stack versions | FastAPI 0.121 · transformers 4.57 · torch 2.9+cpu · Pydantic 2 · Docker `python:3.11-slim` · Gradio |

> ⚠️ README says **"92%"** — *correct it: the notebook says 87%, that's the one I trust.*

---

## ⚙️ Pipeline mechanics (the 3 most-asked)

- **`pipeline()` hides 3 stages:** WordPiece tokenize → transformer forward pass (encoder, 6 layers) → softmax over 77 logits + argmax. Confidence = top softmax prob.
- **Docker layer caching:** copy `requirements.txt` + `pip install` *before* `COPY . .` so the install layer stays cached; `COPY . .` first would **invalidate that layer and every layer after it** on every code edit.
- **F1 not accuracy:** imbalanced data → a majority-class-only predictor scores high but misses fraud. F1 = harmonic mean of precision/recall, per-class; "weighted" loss forces the model to learn rare classes.

---

## 🛠️ "What would you improve?" — lead with this fix-list

> **Single source of truth for concrete code defects** (bugs/security/design with line refs). For *architectural* limitations (fixed taxonomy, no monitoring, uncalibrated confidence, cold start) see [`01` §6](01-my-project-deep-dive.md#6-limitations--what-id-improve-have-these-ready--theyre-often-the-best-part). No item is duplicated between the two.

**Bugs (real):**
- **1.** `predict_intent` returns 2 values, `/debug-test` unpacks 3 → dead.
- **2.** `llm_service.py:75` `generated_text = str` (the type, not `str(result)`).
- **3.** `requirements.txt` lists `requests` twice (`===` typo).
- **4.** `agent_gradio.py` `except` returns 2-tuple, Gradio expects 8.

**Security:**
- **5.** `verify=False` ships to prod → **MITM** on PII tickets.
- **6.** `HF_TOKEN` baked into image via build-arg → ENV → readable via `docker history`.
- **7.** `/agent/debug` = unauthenticated GET that burns LLM quota + fires real Slack.
- **8.** `/predict` echoes raw exceptions → info disclosure.

**Design:**
- **9.** Label strings disagree across 3 files (`card_lost_or_stolen` vs `lost_or_stolen_card`) → **silently fails to escalate fraud**; fix = one Enum.
- **10.** `ReActAgent` isn't ReAct (single-pass router, no observation loop) — say so first.
- **11.** Brittle **regex JSON parse** of LLM output + temp 0.7 & `do_sample=True` for structured output → drop temp to ~0/greedy and move to **function-calling / structured output**.
- **12.** `async def` + blocking `requests`/`time.sleep` → event-loop starvation.
- **13.** Three conflicting "urgent" definitions (>0.7, >0.4, priority enum).
- **14.** Tests are print-scripts; CI checks non-gating (`|| echo skip`) — unit-test `determine_priority` first (pure + business-critical).
- **15.** Unused deps: langchain/openai/slack-sdk.

---

---

# 📚 GENERAL KNOWLEDGE (condensed from files 02–09)

> Everything above is *my project*. Below is the surrounding CS/ML/infra knowledge, rapid-fire. Depth lives in the numbered files.

## 🧠 ML / NLP fundamentals (file 02)

- **Supervised learning** — learn `input→label` from examples; minimize **loss** via gradient descent.
- **Token** — subword int (WordPiece, ~30k vocab); **tokenizer & model are a matched pair**.
- **Embedding** — meaning-as-vector; similar = close (cosine). Foundation of RAG/vector search.
- **Attention** — each token weighs every other token's relevance, **in parallel** (beat sequential RNNs).
- **Encoder (BERT/DistilBERT)** = understanding/classification (bidirectional). **Decoder (GPT/Mistral)** = generation (next-token).
- **DistilBERT** = distilled BERT: ~40% smaller, ~60% faster, ~97% performance (teacher→student).
- **Fine-tune** (change weights) vs **prompt** (steer frozen model: zero/few-shot) vs **train-from-scratch** (never). **LoRA/PEFT** = cheap fine-tuning of a few params.
- **Logits → softmax** = raw scores → probabilities (my confidence).

## 📊 Training & evaluation (file 03)

- **HF workflow:** `AutoTokenizer` → `AutoModelForSequenceClassification` (pretrained body + fresh head) → `TrainingArguments` (config) → `Trainer` (loop). I subclassed → **`WeightedTrainer`** for class weights.
- **Train / val / test** — learn / pick best checkpoint / honest final estimate (touched once). *My notebook used test as eval — small leak, I'll own it.*
- **Class imbalance** → `compute_class_weight("balanced")` into `CrossEntropyLoss` (weights 0.7→3.7) so rare classes (fraud) aren't ignored.
- **Precision** = false-alarm rate; **Recall** = miss rate; **F1** = harmonic mean. **Macro** (all classes equal) vs **weighted** (by size).
- **Confusion matrix** = actual×predicted; my errors are semantically-overlapping intents.
- **Overfitting** = great train / poor test. Guards: weight decay, few epochs, `load_best_model_at_end` by F1, pretraining.

## 🤖 LLMs, agents & RAG (file 04)

- **Inference** (use) vs **training** (create). **7B** = params; **Instruct** = instruction-tuned (RLHF).
- **Context window** = max tokens/call; LLM is **stateless** (re-send history = "memory").
- **Temperature** — 0 = deterministic (use for structured output!), 0.7 = varied (my response gen).
- **Hallucination** — confident falsehoods; mitigate: **RAG**, low temp, human-in-loop, **limit blast radius** (my LLM never makes the classification or takes irreversible action alone).
- **Agent** — LLM picks + takes actions via tools, often in a loop (**ReAct** = Reason→Act→Observe). *Mine = single-decision orchestration, NOT a true loop.*
- **Tool/function-calling** — model emits structured `{tool, args}`; better than my brittle regex-JSON.
- **RAG** = retrieve docs → stuff in prompt → grounded, citable answer. Pipeline: **chunk→embed→vector DB; query→embed→ANN search top-k→LLM**. Vector DBs: **pgvector** (my pick — it's Postgres), FAISS, Pinecone.
- **Fine-tune vs RAG:** *how* to respond (behaviour/style) vs *what facts* to respond with (knowledge, updatable, citable).

## ⚙️ AI infra & MLOps (file 05) — *my home turf*

- **Serving:** model = expensive singleton; **load at startup** (not lazy → cold start). **Sync `def` blocks a worker; `async`+blocking `requests` = worst of both** → use `httpx`/threadpool.
- **Dynamic batching** = group requests into one model run for throughput (vLLM / TGI / Triton).
- **Monitoring's key insight:** an ML service can be **up, fast, and silently wrong** → need **feedback loop** (ground truth) + **drift** monitoring, not just APM.
- **Data drift** (inputs change) vs **concept drift** (input→label changes) vs **staleness** (decay → retrain).
- **Image vs container** = class vs object. **Layer caching:** copy `requirements.txt` before code.
- **K8s** = declarative orchestration: autoscale, self-heal (health probes), rolling deploy/rollback, runtime secrets. *I'm "K8s-ready, not K8s-experienced."*
- **CI/CD for ML** versions **code + model + data** (any one regresses prod). My gaps: **no eval gate, no model registry**.

## 🔌 API & integration (file 06) — *years of this*

- **REST** — verbs + status codes + stateless. **Idempotency** = retry-safe (key for `POST`).
- **Webhook** — service pushes events to your URL (vs polling). My Slack alert is one. Concerns: **verify signature, ack fast + process async, dedupe, retries**.
- **Auth** — API key (svc-to-svc), **OAuth2** (SaaS standard), JWT, HMAC (webhooks), mTLS. **Secrets at runtime, never in image.** *My endpoints have no auth — known gap.*
- **Rate limit** — **token bucket**; signal **429 + Retry-After**; back off w/ jitter. **Circuit breaker** for dead deps.
- **Orchestration** — adapter per system (uniform `{success,...}`), timeouts+retries, graceful degradation, queue for slow downstreams, correlation IDs. *Same as ServiceNow integration — model is one more service.*

## 🏗️ System design method (file 07)

> **Clarify → Contract → Components → Walk one request → Scale → Monitor → Trade-offs.**

- **Always clarify first:** volume, latency, accuracy + cost-of-error, human-in-loop?, PII/residency.
- **Enterprise AI shape:** SaaS webhook → ingestion API (ack fast) → **queue** → scalable workers (classify → RAG → LLM → policy engine) → write back + alert + **log for monitoring/retraining**.
- **Always mention (ML-specific):** confidence thresholds, **human-in-the-loop**, feedback loop, drift, cost-per-request, model versioning, graceful degradation.
- **The bottleneck at scale is the LLM** (cost+latency): cache, cap tokens, self-host w/ batching.

## 🐍 Python (file 08)

- **Comprehension** = `stream().filter().map()` one-liner. **Generator** (`yield`) = lazy `Stream`.
- **Type hints** = advisory (like `@Nullable`), power Pydantic/mypy. **`Optional[X]` = `X | None`**.
- **async/await** = cooperative I/O concurrency (≈ WebFlux); **useless for CPU-bound** (inference).
- **Pydantic** = Java record + Bean Validation + Jackson → FastAPI validation + OpenAPI.
- **Decorator** = annotation + AOP (`@app.post` ≈ `@PostMapping`; custom ≈ around-advice).

## 🔢 Algorithms — sorting & searching (file 09)

- **Big-O:** O(1) hash · O(log n) binary search/B-tree · O(n) scan · O(n log n) good sorts · O(n²) nested loops.
- **Quicksort** O(n log n) avg / **O(n²) worst**, in-place, not stable. **Mergesort** O(n log n) always, O(n) space, **stable**. **Heapsort** O(n log n), in-place. **Timsort** (Java objects / Python `sorted`) = stable + adaptive — the practical winner.
- **Stable** = equal elements keep order (multi-key sorts). Comparison sorts can't beat O(n log n).
- **Binary search** O(log n), **needs sorted**; `lo<=hi`, `mid=lo+(hi-lo)//2`, move past mid.
- **Hash set/map** = O(1) avg lookup → default "make it faster." **BFS** = shortest path unweighted; **DFS** = deep explore.
- **Backend tie-in:** B-tree index = O(log n) seek vs O(n) scan. **RAG vector search** = nearest-neighbour; production uses **ANN/HNSW** for sub-linear search.

---

## 🤷 If asked something you don't know

> *"I haven't gone deep there — my hands-on AI work is one fine-tuned classifier + a hosted LLM; my depth is backend systems. Here's how I'd reason from first principles…"*

→ bridge to HTTP/retries/caching/queues/observability. **Bridging beats bluffing.**

---

## 🧭 Answer structure under pressure

**Claim first (blast radius) → mechanism → trade-off.**

Be specific:
- "man-in-the-middle," not "security issue"
- "event-loop thread," not "threads"
- "teacher-student distillation," not "smaller and faster"
