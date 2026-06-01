# 08 — Python Refresher

> Practical Python for the role, mapped to Java where it helps. I write Python in this project but I'm a Java dev by instinct — this closes the idiom gap so I sound fluent, not translated.

---

## 1. Comprehensions — the Python idiom interviewers expect

Compact way to build lists/dicts/sets from iterables. **Pythonic = use these instead of manual loops.**

```python
# List comprehension
squares = [x*x for x in range(10)]
urgent = [t for t in tickets if t.confidence > 0.7]          # filter

# Dict comprehension — exactly how I built my label maps (banking77 notebook)
id2label = {i: label for i, label in enumerate(class_names)}
label2id = {label: i for i, label in enumerate(class_names)}

# Set comprehension
seen_intents = {t.intent for t in tickets}
```
> **Java analogy:** `[x*x for x in xs if cond]` ≈ `xs.stream().filter(cond).map(x -> x*x).collect(toList())` — but one line, no boilerplate.

---

## 2. Generators — lazy iteration (memory-efficient)

A function with `yield` produces values **one at a time, on demand**, instead of building the whole list in memory.

```python
def read_tickets(path):
    with open(path) as f:
        for line in f:               # streams the file, never loads it all
            yield line.strip()

for ticket in read_tickets("huge.txt"):   # processes lazily
    process(ticket)

# Generator expression — like a comprehension but lazy (parens, not brackets)
total = sum(len(t) for t in read_tickets("huge.txt"))
```
- **Why it matters for ML/data:** stream a dataset too big for RAM; process batches without materializing everything.
> **Java analogy:** a generator ≈ a lazy `Stream` / `Iterator` — pull-based, evaluated on demand.

---

## 3. Type hints — Python's optional static typing

Annotations document intent and power tooling (mypy, IDE autocomplete, FastAPI/Pydantic validation). **Not enforced at runtime** by Python itself.

```python
from typing import Optional

def predict_intent(text: str) -> tuple[str, float]:    # my real signature
    ...

def generate(self, prompt: str, max_tokens: Optional[int] = None) -> dict:
    ...
```
- `Optional[X]` = `X | None`. `list[str]`, `dict[str, Any]`, `tuple[str, float]`.
- **In my project:** type hints drive Pydantic/FastAPI — the request/response models *are* type hints that FastAPI turns into validation + OpenAPI docs.
> **Java analogy:** like declaring types, but advisory — closer to `@Nullable` annotations than compiler-enforced types. A linter, not `javac`.

---

## 4. async / await — concurrency for I/O

`async def` defines a **coroutine**; `await` yields control while waiting on I/O so other work runs. Single-threaded **cooperative** concurrency (an event loop), not parallel threads.

```python
import httpx

async def classify(text: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(URL, json={"text": text})   # yields during the wait
        return resp.json()
```
- **Great for:** many concurrent network calls (my LLM/Slack/classifier calls). **Useless for:** CPU-bound work (model inference) — that needs threads/processes.
- **My honest gap (file 05):** `/agent/predict` is `async def` but calls **blocking `requests`**, which *doesn't* yield the loop — I should use `httpx`/`aiohttp` or a threadpool. Knowing *why* that's wrong is the point.
> **Java analogy:** like `CompletableFuture` / reactive WebFlux — non-blocking I/O on an event loop. Blocking `requests` inside `async def` = a blocking JDBC call inside a reactive chain: it defeats the purpose.

---

## 5. Pydantic — validation & typed models (FastAPI's backbone)

Define data shapes as classes; Pydantic **validates and coerces** input at runtime and serializes output.

```python
from pydantic import BaseModel
from typing import Optional

class PredictionRequest(BaseModel):     # my real model
    text: str

class AgentResponse(BaseModel):
    status: str
    response: str
    confidence: Optional[float] = None
    processing_time: float
    llm_cost: float
```
- FastAPI uses these to **validate requests (400 on bad input), serialize responses, and auto-generate OpenAPI docs**.
- v2 is fast (Rust core). Supports defaults, constraints, nested models, custom validators.
> **Java analogy:** Pydantic = **Java record + Bean Validation (`@NotNull`, `@Valid`) + Jackson** in one. This is the single most important Python library for *this* role — it's the typed-contract layer I already value in Spring.

---

## 6. Decorators — wrapping behaviour around functions

A decorator is a function that takes a function and returns an enhanced one — **cross-cutting concerns without touching the body.**

```python
@app.post("/predict")          # FastAPI: registers the route (decorator!)
def predict(request: PredictionRequest):
    ...

# Roll your own (e.g. timing) — like a Spring AOP aspect
import functools, time
def timed(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        start = time.time()
        result = fn(*args, **kwargs)
        print(f"{fn.__name__} took {time.time()-start:.3f}s")
        return result
    return wrapper

@timed
def slow_thing(): ...
```
- **In my project:** every FastAPI route (`@app.post`, `@app.get`) and `@classmethod` in settings is a decorator. I use them; I haven't written many custom ones.
> **Java analogy:** decorators ≈ **annotations + AOP** (`@Transactional`, `@RestController`). `@app.post("/predict")` is doing what `@PostMapping("/predict")` does — registering a handler — and a custom decorator is a hand-written around-advice aspect.

---

## 7. Other idioms worth a sentence

```python
# f-strings — formatting (everywhere in my logs)
logger.info(f"Prediction: {intent} (confidence: {confidence:.4f})")

# Context managers — guaranteed setup/teardown (≈ try-with-resources)
with open(path) as f: ...

# *args / **kwargs — variadic args (my WeightedTrainer.compute_loss uses **kw)
def f(*args, **kwargs): ...

# Dict .get with default — safe access (no KeyError)
intent = result.get("prediction", "unknown")    # my classification_tool

# Truthiness — empty string/list/dict/None are falsy
if not request.text.strip(): raise HTTPException(...)

# Ternary
priority = "high" if is_urgent else "low"
```

---

## 8. Likely interview questions + model answers

**Q1. "When would you use a generator instead of a list?"**
> "When I don't need everything in memory at once — streaming a large dataset or file. A list builds and holds every element; a generator yields one at a time, lazily. So summing line lengths in a huge file, I'd use a generator expression and never load the file. It's Python's lazy Stream."

**Q2. "What does async/await actually do, and when is it useless?"**
> "It's cooperative concurrency on a single-threaded event loop — `await` yields control during I/O so other coroutines run, which is great for many concurrent network calls. It's useless for CPU-bound work like model inference, because that doesn't yield — it just hogs the loop. That's actually a bug in my own code: my agent endpoint is async but uses blocking requests, so it doesn't yield during the LLM call. The fix is an async HTTP client or running the blocking call in a threadpool."

**Q3. "Why is Pydantic everywhere in FastAPI apps?"**
> "It turns type hints into runtime validation, serialization, and OpenAPI docs. I define a request model as a class with typed fields, and FastAPI rejects malformed input with a 400, coerces types, and documents the endpoint automatically. Coming from Spring, it's basically a Java record plus Bean Validation plus Jackson in one object — the typed-contract layer I already rely on."

**Q4. "Explain decorators."**
> "A decorator wraps a function to add behaviour without changing its body — cross-cutting concerns. Every FastAPI route is one: `@app.post('/predict')` registers the handler, just like `@PostMapping` in Spring. You can write your own for things like timing or auth, which is essentially hand-rolled AOP around-advice."

**If I'm asked something deep I don't know** (metaclasses, GIL internals, descriptors):
> "I know that at a 'what it's for' level but I haven't needed it in practice — I write straightforward, typed, readable Python for services. My depth is in API and systems design; I lean on idiomatic Python rather than its metaprogramming corners." Honest and fine.

---

## 9. Quick Java→Python cheat

| Java | Python |
|---|---|
| `record` + Bean Validation | Pydantic `BaseModel` |
| `stream().filter().map()` | comprehension |
| lazy `Stream` / `Iterator` | generator (`yield`) |
| `@RestController` / `@PostMapping` | `@app.post(...)` decorator |
| `@Transactional` (AOP) | custom decorator |
| `CompletableFuture` / WebFlux | `async`/`await` + event loop |
| try-with-resources | `with` context manager |
| `Optional<T>` | `Optional[T]` / `T | None` |
| `@Nullable` (advisory) | type hints (advisory) |
| Maven/Gradle deps | `requirements.txt` / pip |
