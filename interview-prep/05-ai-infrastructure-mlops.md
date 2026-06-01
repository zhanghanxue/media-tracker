# 05 — AI Infrastructure & MLOps (HIGH PRIORITY)

> The other most important file for "software engineering FOR AI." This is **my home turf** — it's backend/infra engineering applied to ML. Lean in here; this is where 6 years of Spring Boot + ServiceNow actually transfers and where I'm strongest.

---

## 1. Serving a model behind an API

### The core shape
A model server is just a web service with one unusual dependency: a large model loaded in memory. My `/predict` (`main.py:54`) is a FastAPI endpoint that calls `predict_intent()`, which runs the DistilBERT pipeline and returns JSON. **Conceptually identical to a Spring `@RestController` calling a `@Service`** — the model is just an expensive singleton bean.

### Latency — where time actually goes
- **Cold start / model load** — loading 67M params + the framework on first request is slow. My `prediction.py` **lazy-loads** the model (`if classifier is None`) on first call, so the *first* request after boot pays the price. **Fix:** load at startup (FastAPI `lifespan`/startup event) so the container is "warm" before it serves traffic — like eager `@PostConstruct` bean init instead of lazy.
- **Inference time** — the actual forward pass. CPU (my case, free HF Spaces) is much slower than GPU. DistilBERT was chosen partly *because* it's fast on CPU.
- **Network** — my LLM step is a remote HTTP call to the HF Inference API (`llm_service.py`), so most of my agent latency is network + remote inference, not my own compute. I set a 45s timeout and retry on 503/429.

### Sync vs async — a real issue in my code
- My `/predict` is a **synchronous** `def` (`main.py:55`). Under FastAPI, a sync endpoint doing CPU-bound work **blocks a worker thread** for the whole inference. Fine for a demo, bad under load.
- My `/agent/predict` is **`async def`** but the LLM call inside uses **blocking `requests`** — so it doesn't actually yield the event loop during the network wait. **Honest bug:** mixing `async def` with blocking `requests` gives you the worst of both. The fix is either a true async HTTP client (`httpx`/`aiohttp`) or running blocking work in a threadpool.

> **Spring analogy:** this is the classic "blocking call on the event loop" problem — like doing a synchronous JDBC call inside a WebFlux reactive chain. The model inference is your slow I/O; you either make it truly async or isolate it on a worker pool so it doesn't starve everything else.

### Batching — the throughput lever
- **Dynamic batching:** instead of running the model once per request, the server **groups several requests arriving close together into one batch** and runs the model once. GPUs are massively more efficient per-item on batches, so this multiplies throughput.
- **I don't do this** — I process one ticket at a time. **Trade-off:** batching adds a few ms of latency (waiting to fill a batch) for big throughput gains. Worth it at scale, not for a demo.
- Production servers built for this: **vLLM**, **TGI (Text Generation Inference)**, **Triton Inference Server**. Good names to drop for "how would you serve this at scale."

### Concurrency model
- One model instance + many requests → you need either multiple worker processes (each with the model loaded — memory cost) or a request queue in front of a batcher. My single-replica, single-model setup handles one-at-a-time; scaling means more replicas (§4 K8s) or a batching server.

---

## 2. Monitoring ML in production — the part that makes it *ML*ops

A normal service is "healthy" if it's up and fast. **An ML service can be up, fast, and silently wrong.** This is the key insight and a great thing to say out loud.

### What to monitor (three layers)
1. **Operational (same as any API):** latency, error rate, throughput, CPU/memory, uptime. My `/health` and `/agent/health` cover liveness; my cost tracking (`/agent/metrics`) covers spend.
2. **Model quality (the ML-specific layer):**
   - **Accuracy degradation** — is the model still right? You need **ground-truth labels** to know — e.g. did the human agent agree with the triage? That requires a **feedback loop** capturing corrections. **My project has none of this yet** — honest gap.
   - **Prediction distribution** — if `fraudulent_transaction` suddenly spikes from 2% to 30% of predictions, something changed (attack, or model broke).
   - **Confidence distribution** — a drop in average confidence is an early warning.
3. **Data drift / model drift:**
   - **Data drift** — the *inputs* change vs training data. New product launches, new slang, a new ticket channel → text the model never saw. The model didn't change; the world did.
   - **Concept drift** — the *relationship* between input and correct label changes (e.g. "verification" now means something new after a policy change).
   - **Model drift / staleness** — performance decays over time as drift accumulates. Models aren't "ship once" — they need **retraining schedules**.

### How you detect drift
- Statistical comparison of live input distributions vs the training baseline (e.g. PSI, KL-divergence, embedding-distribution monitoring).
- Track per-class prediction rates and confidence over time; alert on shifts.
- Tools: **Evidently**, **WhyLabs**, **Arize**, or roll basic stats into your own dashboards.

> **Spring/ServiceNow analogy:** ops monitoring is your existing APM (latency, errors) — I know this. The *new* idea is that correctness isn't guaranteed by "200 OK": you also need a **feedback loop** that captures whether the prediction was actually right, the way a ServiceNow workflow captures whether a ticket's auto-assignment was later reassigned by a human. That reassignment *is* your ground-truth label.

### What I'd build for my project
1. **Log every prediction** (input, intent, confidence, action taken) to a store.
2. **Capture feedback** — when a human agent re-triages a ticket, that's a label; compute live precision/recall against it.
3. **Monitor input drift** — embed incoming tickets, watch the embedding distribution vs the banking77 baseline.
4. **Alert + retrain trigger** — if live F1 drops below a threshold or drift exceeds a bound, alert and kick off retraining.

---

## 3. Docker & images — containerization

- **Image** = an immutable, layered snapshot of everything the app needs (OS libs, Python, deps, model code). **Container** = a running instance of an image. *Image is the class, container is the object.*
- **Why it matters for ML especially:** ML has brutal dependency hell — exact `torch`/`transformers`/CUDA versions. A container freezes "works on my machine" into a portable artifact. **This is the single biggest reproducibility win for ML deployment.**

**My Dockerfile (`Dockerfile`), decisions worth explaining:**
- `FROM python:3.11-slim` — slim base to keep the image small.
- **`COPY requirements.txt .` before `COPY . .`** — this is **layer caching**: dependencies (slow to install) are a separate layer that only rebuilds when `requirements.txt` changes, not on every code edit. **Real, deliberate optimization** I can speak to.
- `ENV PYTHONUNBUFFERED=1` — logs stream immediately (important for container log capture).
- `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]` — runs the ASGI server.

> **Honest security flag (also in my fix-list):** my Dockerfile takes `HF_TOKEN` as a build `ARG` → `ENV`, and CI passes secrets as `build-args`. **Secrets baked into image layers are recoverable from the image** — they should be injected at *runtime* (env vars / secrets manager), never built in. I know this is wrong and how to fix it; great thing to volunteer.

> **Spring analogy:** a Docker image is your runnable fat-JAR plus the JRE plus the OS — the whole environment, not just the app. Layer caching is like incremental builds: only the changed layers rebuild.

---

## 4. Why Kubernetes (and when you don't need it)

**Kubernetes (K8s)** orchestrates containers across a cluster of machines. You declare desired state ("I want 5 replicas of this image, behind a load balancer, with these health checks") and K8s makes reality match.

**What it gives an ML service:**
- **Horizontal scaling / autoscaling** — spin up more model-server replicas under load (HPA). Each replica loads the model; the LB spreads traffic.
- **Self-healing** — a crashed/unhealthy container (failing `/health`) is restarted/replaced automatically. *My `/health` endpoint exists exactly so an orchestrator can probe liveness.*
- **Rolling deployments / rollback** — ship a new model version with zero downtime; roll back instantly if metrics tank.
- **Resource scheduling** — pack GPU/CPU workloads onto nodes efficiently; request GPUs per pod.
- **Config/secrets management** — ConfigMaps/Secrets inject env at runtime (the *right* place for my `HF_TOKEN`).

**Honest scoping:** my project runs on **HF Spaces — a single managed container, no K8s.** I haven't operated a K8s cluster. I understand *what problems it solves* and how my service (stateless, health-checked, containerized, config-via-env) is **already shaped to run on it.** That's the honest claim: "K8s-ready, not K8s-experienced."

> **When you DON'T need K8s:** single low-traffic service, a demo, or a managed platform (HF Spaces, Cloud Run, App Runner) that handles scaling for you. K8s is operational overhead you earn your way into at scale. Saying this shows judgment, not just buzzwords.

> **ServiceNow/Spring analogy:** K8s is the "app server + load balancer + supervisor" layer you used to get from a managed WebLogic/app-server cluster — declarative replicas, health checks, and rolling restarts, but for containers instead of WARs.

---

## 5. CI/CD for ML

Standard CI/CD + extra concerns because **a model is a second artifact that can regress without any code change.**

**My pipeline (`.github/workflows/cicd.yml`) — what it does:**
1. On push to `main`: **build the Docker image**, push to **GHCR** (GitHub Container Registry), tagged with the commit SHA + `latest`.
2. **Smoke-test the *running container*** — start it, poll `/health`, then `curl` `/predict`, `/agent/predict`, `/agent/health`. **This tests the real artifact, not just unit tests** — a genuinely good practice.
3. If green and on `main`: **deploy to HF Spaces** by packaging `app/` + requirements + Dockerfile and `git push --force` to the Space repo.

**What's strong about it:**
- Tests the actual container that will ship (catches dependency/packaging issues, not just logic).
- SHA-tagged images = traceable, rollback-able artifacts.
- Build-once, deploy-the-same-image principle.

**What's missing (the "ML" in CI/CD — my honest gaps):**
- **No model evaluation gate** — CI checks endpoints respond, but doesn't assert the model still hits an F1 threshold. A regressed model would deploy green. **The ML-specific addition** would be a held-out eval set that fails the build if accuracy drops.
- **No model versioning / registry** — the model lives on HF Hub by name, not pinned per-deploy. Real MLOps pins model version alongside code version so a deploy is reproducible.
- **No data/training pipeline in CI** — training is a manual Colab notebook. Mature setups automate retraining + eval.
- **`git push --force`** to deploy throws away Space history — works, but crude.

> **The big idea to articulate:** *"In normal CI/CD you version and test code. In ML CI/CD you have to version and test **three** things — code, model, and data — because any one of them can break production while the other two are green. My pipeline does the code part well and the artifact-testing part well; the model-evaluation gate and model registry are what I'd add to make it true MLOps."* This single sentence shows you understand the discipline.

---

## 6. Likely interview questions + model answers

**Q1. "How would you serve this model to handle real production traffic?"**
> "Several moves. First, load the model at startup instead of lazily, so no request eats the cold-start cost. Second, fix the concurrency — my `/predict` is synchronous and blocks a worker, and my agent endpoint is async but uses blocking `requests`; I'd use an async HTTP client or a threadpool so inference doesn't starve the event loop. Third, add dynamic batching — group requests and run the model once per batch — using a server like vLLM or TGI for the LLM side. Then scale horizontally: containerize (already done), run multiple replicas behind a load balancer on Kubernetes or a managed platform, with health checks and autoscaling on latency or queue depth."

**Q2. "A model's been in production for six months. How do you know it's still good?"**
> "You can't assume it is — that's the core MLOps insight. A model can be up, fast, and silently wrong because the world drifts away from its training data. I'd monitor three layers: operational metrics like latency and errors; model-quality signals like the prediction and confidence distributions; and data drift by comparing live input distributions against the training baseline. The crucial piece is a feedback loop — capturing ground truth, like when a human agent re-triages a ticket the model auto-triaged — so I can compute live precision and recall and trigger retraining when it decays. My current project logs predictions but has no feedback loop yet; that's the first thing I'd build."

**Q3. "What's different about CI/CD for ML versus normal software?"**
> "Normal CI/CD versions and tests code. ML CI/CD has to handle three artifacts — code, model, and data — because any one can regress production while the others look fine. So beyond building and testing the container, which my pipeline does — it actually starts the image and smoke-tests the endpoints — you add a model-evaluation gate that fails the build if accuracy on a held-out set drops, plus a model registry so each deploy pins a specific model version. Those last two are the gaps in my current pipeline and exactly what I'd add."

**Q4. "Why containerize an ML service? What does Docker buy you?"**
> "Reproducibility, mainly. ML has severe dependency sensitivity — exact torch, transformers, CUDA versions — and a container freezes the entire environment into a portable, immutable artifact, so 'works on my machine' becomes 'works everywhere.' In my Dockerfile I also use layer caching — copying requirements before the code so dependency installs only rebuild when deps change — and the container exposes a health endpoint so an orchestrator can manage it. One thing I'd fix: I currently bake the HF token in as a build arg, which leaks it into image layers; secrets belong at runtime."

**Q5. "Do you have Kubernetes experience?"**
> "I'll be straight: I haven't operated a K8s cluster — my project runs on Hugging Face Spaces, a single managed container. But I understand what K8s solves — horizontal autoscaling, self-healing via health probes, rolling deploys and rollback, runtime secrets — and I built my service to be K8s-ready: it's stateless, containerized, health-checked, and configured through environment variables. So I'd be productive on it quickly; I just haven't run the control plane myself."

**Q6. "Where's the latency in your system and how would you cut it?"**
> "Three sources: cold-start model loading on the first request, which I'd fix by loading at startup; CPU inference, which is why I picked DistilBERT and would move to GPU or a batching server at scale; and the remote LLM network call, which dominates my agent latency. For the LLM I'd add caching for repeated/similar prompts, lower the token budget, and make the call genuinely async so it doesn't block other requests. I'd also add dynamic batching on the model side for throughput."

**If I'm asked something I don't know** (e.g. Istio, GPU scheduling specifics, Kubeflow):
> "I haven't used that directly. My infra depth is the service layer — APIs, containers, CI/CD, health checks, config — and I understand the problem that tool solves even where I haven't operated it." Bridge to your Spring/ops experience.

---

## 7. Terms to define in one line

- **Cold start** — first-request penalty for loading the model; fix by loading at startup.
- **Dynamic batching** — group requests into one model run for throughput (vLLM/TGI/Triton).
- **Data drift** — inputs change vs training data; model unchanged, world changed.
- **Concept drift** — the input→label relationship changes.
- **Model staleness** — accuracy decays over time; needs retraining.
- **Feedback loop** — capturing ground truth in prod to measure live accuracy.
- **Image vs container** — immutable snapshot vs running instance.
- **Layer caching** — Docker rebuilds only changed layers (deps before code).
- **K8s** — declarative container orchestration: scaling, self-healing, rolling deploys.
- **Health probe** — endpoint an orchestrator polls for liveness/readiness (my `/health`).
- **Model registry** — versioned store of models, pinned per deploy.
- **Eval gate** — CI step that fails the build if model metrics regress.
