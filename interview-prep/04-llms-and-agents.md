# 04 — LLMs & Agents (HIGH PRIORITY)

> One of the two most important files for this role. Covers LLM mechanics, what an "agent" really is (and what mine really is), tool-use/function-calling, and RAG as my concrete next step. Honest framing throughout — I use a hosted LLM and built a *tool-using orchestration*, not a research-grade agent.

---

## 1. LLM basics — the mental model

A **Large Language Model** is a decoder-only transformer trained on enormous text to do one thing: **predict the next token**. Everything else (answering, summarizing, reasoning) **emerges** from doing that extremely well at scale.

### Inference vs training
- **Training** = learning the weights (months, thousands of GPUs, done once by Mistral/OpenAI). I never do this.
- **Inference** = *using* the trained model to generate text (every API call). This is all I do — I call **Mistral-7B-Instruct** via the HF Inference API (`llm_service.py`).
- **"7B"** = 7 billion parameters. Bigger ≈ more capable but slower and costlier. 7B is a sweet spot that runs on a single GPU.
- **"Instruct"** = instruction-tuned: further trained (often with RLHF) to follow instructions/chat, not just autocomplete. That's why I can give it a system prompt and get a structured response.

### Context window
- The **context window** is the max tokens the model can "see" at once — prompt + generated output combined.
- Everything the model knows *for this request* must fit in the window; there's no memory between calls unless you re-send it.
- **In my project:** my prompt = system prompt + ticket + classification result (`react_agent.py:106`), and I cap output at `max_new_tokens=200` (`settings.py`). Tickets are short, so I'm nowhere near the limit — but in a long-conversation system this is the first constraint you hit.

> **Spring analogy:** the LLM is **stateless**, like a REST endpoint. Each `/generate` call is independent — if you want "memory," you re-send the history every time (like passing state in the request body, not a server session). This is why chat apps re-send the whole conversation each turn.

### Temperature & sampling
- **Temperature** controls randomness. **0** = deterministic, always the highest-probability token (good for classification/extraction). **Higher (0.7–1.0)** = more varied/creative (good for natural language).
- **In my project:** `LLM_TEMPERATURE=0.7` + `top_p=0.9` + `do_sample=True` (`llm_service.py:38`) — I want a natural-sounding customer response, so some randomness is fine.
- **Trade-off & honesty note:** temperature 0.7 fights *against* my regex JSON parsing — higher temperature = more format variation = more parse failures. For the **structured decision** part I should run **temperature 0** (or use function-calling). Good self-aware point to raise.

### Non-determinism
- Same prompt can give **different outputs** across calls (sampling + backend batching). This breaks the assumptions of backend engineers used to pure functions.
- **Consequences I handle:** can't cache by output, can't write exact-match tests, must parse defensively (my `_parse_agent_response` has fallbacks), and must design for "the model returns something unexpected."

### Hallucination
- **Hallucination** = the model states false things **fluently and confidently**. It optimizes for plausible-sounding text, not truth — it has no ground-truth lookup.
- **Why it's the #1 production risk:** a confident wrong answer to a customer is worse than no answer.
- **Mitigations:** **RAG** (ground answers in real documents — §5), low temperature, asking for citations, keeping a human in the loop for high-stakes actions, and constraining the model's job.
- **In my project:** I limit the blast radius — the LLM **doesn't make the classification decision** (the trustworthy fine-tuned model does) and **doesn't take irreversible actions** on its own. Even the Slack escalation is gated by my deterministic `is_urgent` rule, not the LLM's say-so. *That's hallucination containment by architecture.*

---

## 2. What is Mistral-7B-Instruct?

- An **open-weight**, decoder-only **7B-parameter** LLM from Mistral AI, **instruction-tuned** for chat/following directions.
- **Open-weight** matters: I can run it myself or call it on HF without being locked to one vendor — relevant to enterprise cost/privacy concerns.
- **In my project:** I call `mistralai/Mistral-7B-Instruct-v0.1` through the **HF Inference API** — I do *not* host it. I send a prompt, get text back, track latency-based cost. It's the "reasoning + response drafting" half of my two-model design.

> **Why a 7B and not GPT-4-class?** Cost and "good enough." Drafting a support reply and picking an action doesn't need a frontier model. A small open model on a free tier was the right call for a $0-budget project — and demonstrates cost-conscious model selection, which enterprise AI infra cares about.

---

## 3. What makes something an "agent"? (and what mine actually is)

**Plain definition:** an **agent** is an LLM that can **take actions** in the world (via **tools**) and **decide which actions to take**, usually in a **loop**, to accomplish a goal — rather than just emitting text.

The canonical pattern is **ReAct (Reason + Act)**:
```
Thought → Action → Observation → Thought → Action → Observation → ... → Final Answer
```
The model reasons, calls a tool, *sees the result*, reasons again, and loops until done.

**My honest position — what `ReActAgent` actually is:**
My `react_agent.py` is a **tool-using orchestration with a single LLM decision step**, *not* a true ReAct loop. The real flow:
1. **Always** classify first (deterministic — not the LLM's choice).
2. Make **one** LLM call to decide an action (`classify` / `slack_alert` / `respond`).
3. Execute that action, with a deterministic fallback if the LLM fails.
4. Return. **No observation-driven loop** — `max_steps` is set but never iterated.

So it has the **ingredients** of an agent — tools (`classification_tool`, `slack_tool`), an LLM making a decision, and real-world actions (Slack) — but it doesn't iterate over observations. **I'll say exactly that in the interview.** It's a defensible, honest description, and arguably *better engineering* for this use case: a bounded, predictable pipeline beats an open-ended loop when the workflow is known and you're paying per token.

> **Why this honesty wins:** an interviewer who knows agents will immediately spot a fake ReAct loop. Pre-empting it ("I called it ReAct, but precisely it's a single-decision orchestration with deterministic guardrails — here's why that's appropriate") reads as senior, not as a gap.

**When would a *real* loop be worth it?** When the task needs *chained* tool calls whose next step depends on the previous result — e.g. "look up the customer → check their last 3 transactions → decide → maybe escalate." My single ticket→action flow doesn't need that.

---

## 4. Tool use / function calling

**Tool use** = giving the LLM a set of callable functions (with names + schemas) and letting it **emit a structured request** to call one. The *framework* executes it and feeds the result back.

- **Modern way — function/tool calling:** you pass the model a JSON schema of available tools; the model returns a structured `{tool, arguments}` object the runtime can execute safely. Supported natively by OpenAI, Anthropic, Mistral, etc.
- **My way (older/manual):** I prompt Mistral to return JSON (`{thought, action, action_input}`) and **parse it with a regex** (`_parse_agent_response`, `react_agent.py:53`). This is the pre-function-calling pattern — it works but is **brittle**: the model can return malformed JSON, prose around the JSON, or the wrong field names.
- **The upgrade I'd make:** switch to native function-calling / a structured-output mode (or a Pydantic-validated schema). That removes the regex, removes a class of parse failures, and is the honest "what I'd improve" answer.

> **Spring analogy:** tool-calling is like the LLM returning a **command DTO** that your dispatcher routes to the right `@Service` method — except the LLM picks the command. The schema is the contract; my regex approach is like parsing free-text instead of deserializing a typed DTO, which is exactly the fragility a backend engineer would want to remove.

**Security note (matters for enterprise AI):** tools are the point where an LLM touches real systems. You must **validate arguments, scope permissions, and gate destructive/irreversible actions** — never let model output directly trigger something like "delete account." My design gates the only real action (Slack escalation) behind a deterministic rule, not raw LLM output.

---

## 5. RAG & vector search (my concrete next step — know this cold)

**RAG = Retrieval-Augmented Generation.** Instead of relying on what the LLM memorized in training, you **retrieve relevant documents at query time and stuff them into the prompt** so the model answers *from real, current, authoritative content.*

### Why RAG exists (the problems it solves)
- **Hallucination** — grounds answers in actual documents instead of the model's guesses.
- **Stale knowledge** — the model's training is frozen; RAG injects fresh/internal data it never saw.
- **No training needed** — you add knowledge by indexing documents, not by fine-tuning.
- **Citations** — you can show *which* document an answer came from (huge for enterprise trust).

### How it works (the pipeline)
```
INDEX (offline):  docs → chunk → embed each chunk → store vectors in a vector DB
QUERY (per request):
  user question → embed it → vector search for top-k nearest chunks
                → put those chunks + question into the LLM prompt
                → LLM answers grounded in the retrieved text (+ cites sources)
```
- **Embeddings** (file 02 §3) turn text into vectors where semantic similarity = closeness.
- **Vector search** finds the chunks whose embeddings are nearest the question's embedding (cosine similarity), via **approximate nearest-neighbour (ANN)** indexes like **HNSW**.
- **Vector DBs:** FAISS (library), pgvector (Postgres extension — *my comfort zone*), Pinecone/Weaviate/Qdrant (managed).

> **Spring/Postgres analogy:** vector search is a `WHERE` clause on *meaning* instead of exact values — "find the 5 rows most semantically similar to this question" instead of `WHERE id = ?`. With **pgvector** it's literally a new column type and an `ORDER BY embedding <-> query LIMIT 5` — which is why I'd reach for it first: it's Postgres, which I already know.

### How I'd add RAG to MY project (the answer to "what's next?")
Right now my LLM **improvises** customer responses — pure hallucination risk. I'd ground it:
1. **Index our support knowledge base** — help-centre articles, past resolved tickets, policy docs — chunk and embed them into **pgvector** (Postgres I already run) or FAISS for a demo.
2. **On each ticket**, after classifying the intent, **embed the ticket and retrieve the top-k relevant articles** for that intent.
3. **Feed those articles + the ticket into Mistral's prompt** so the response is grounded in *real* support policy, not invented — e.g. for a `card_not_working` ticket it cites the actual troubleshooting steps.
4. **Return the source articles** alongside the answer so agents/customers can verify.

**Result:** the same architecture, but the LLM stops making things up and starts answering from authoritative content — directly attacking my system's biggest weakness (an ungrounded generative step).

> **Fine-tuning vs RAG (classic interview question):** fine-tuning teaches the model new *behaviour/style/format*; RAG gives it new *knowledge/facts* at query time. For "answer from our docs," RAG wins — it's cheaper, updatable without retraining, and citable. You fine-tune for *how* to respond, you RAG for *what* facts to respond with. Often you do both.

---

## 6. Likely interview questions + model answers

**Q1. "What makes your system an agent?"**
> "I'll be precise about this. It has the ingredients of an agent — it uses tools, a classifier and a Slack notifier, and an LLM decides which action to take. But it's a single-decision orchestration, not a true ReAct loop: it classifies deterministically, makes one LLM call to choose an action, then executes with a fallback. It doesn't iterate over observations. For a known, bounded triage workflow I'd argue that's the *right* design — predictable and cheap — but I won't call it more than it is."

**Q2. "How do you handle LLM hallucination in production?"**
> "Architecturally, by limiting the blast radius. The LLM in my system doesn't make the classification decision — my fine-tuned model does — and it can't take irreversible actions on its own; the Slack escalation is gated by a deterministic rule, not the model's word. The bigger fix on my roadmap is RAG: ground the LLM's responses in our actual support docs so it answers from real content instead of improvising, and return the source so answers are verifiable."

**Q3. "Explain RAG and when you'd use it."**
> "RAG retrieves relevant documents at query time and puts them in the prompt so the model answers from real content instead of memory. You index your docs as embeddings in a vector store, embed the user's question, do a nearest-neighbour search for the most relevant chunks, and feed those plus the question to the LLM. You use it when answers must be grounded in specific, current, or private knowledge — like a support knowledge base. It beats fine-tuning for facts because it's updatable without retraining and you can cite sources. In my project it's the obvious next step: my LLM currently improvises responses, and RAG would ground them in our actual help-centre articles. I'd probably start with pgvector since I already know Postgres."

**Q4. "Temperature — what is it and what did you set it to?"**
> "It controls output randomness — zero is deterministic, higher is more varied. I run 0.7 for the response generation because I want natural-sounding replies. Honestly, that fights my JSON-parsing step, so for the structured decision part I should drop to zero or use function-calling — variability there just causes parse failures."

**Q5. "What's the difference between fine-tuning and RAG?"**
> "Fine-tuning changes the model's weights to teach it new behaviour, style, or format. RAG doesn't touch the model — it supplies new knowledge at inference time by retrieving documents into the prompt. Rule of thumb: fine-tune for *how* to respond, RAG for *what facts* to respond with. For my support use case RAG is the right tool because the knowledge changes and needs to be citable."

**Q6. "Why function-calling over your regex JSON parsing?"**
> "Function-calling gives the model a schema and returns a structured, validated object the runtime can execute — versus my current approach of prompting for JSON and parsing it with a regex, which breaks when the model returns malformed JSON or extra prose. It's the same reason I'd deserialize a typed DTO instead of parsing free text in a backend service. It's a clear upgrade on my list."

**If I'm asked something I don't know** (e.g. specific vector-DB internals, RLHF details, KV-cache):
> "I know that at a conceptual level — [one sentence] — but I haven't implemented it. My hands-on LLM work is calling a hosted model and orchestrating it safely; my depth is the systems and integration side." Then bridge to retries/caching/contracts.

---

## 7. Terms to define in one line

- **Inference vs training** — using the model vs creating it.
- **Context window** — max tokens the model sees per call; it's stateless between calls.
- **Temperature** — randomness dial; 0 = deterministic.
- **Hallucination** — confident, fluent falsehoods; mitigate with RAG / low temp / human-in-loop.
- **Instruction-tuned** — trained to follow instructions (why system prompts work).
- **Agent** — LLM that chooses and takes actions via tools, often in a loop.
- **ReAct** — Reason→Act→Observe loop (what mine *approximates*, not implements).
- **Tool / function calling** — model emits a structured request to call a function.
- **RAG** — retrieve docs at query time, ground the answer in them.
- **Embedding / vector search** — meaning-as-vectors + nearest-neighbour lookup.
- **Vector DB** — stores embeddings for fast similarity search (pgvector, FAISS, Pinecone).
- **Open-weight** — model weights are downloadable (Mistral) vs API-only (GPT-4).
