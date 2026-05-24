# Testing Strategy

Operational reference for AI agents (and humans) implementing this project. **Read this before writing any tests.**

---

## TL;DR

- Pyramid weighted toward **pure-function unit tests** + **repository integration tests**
- **No React component tests in v1** (UI churn rate is too high for them to earn their maintenance cost)
- **Vitest + `@cloudflare/vitest-pool-workers`** (real D1 in test mode, not mocked DB)
- Mock **only at external boundaries** (AniList API, upstream image fetches)
- **No coverage tracking in v1**

---

## Test stack

| Layer | Tool | Notes |
|---|---|---|
| Runner | Vitest | Already in the chosen frontend stack |
| Worker / D1 / R2 in tests | `@cloudflare/vitest-pool-workers` | Provides real D1 in test mode; identical query semantics to production |
| External HTTP mocking | `fetch` mock via vitest's `vi.fn()` | Return captured AniList JSON fixtures |
| R2 mocking | Provided by `vitest-pool-workers` | Real R2 binding API exposed against an in-process stub |

---

## Approach by module class

| Module class | Strategy | Why |
|---|---|---|
| **Pure functions** — `TitleDisplay`, `FilterQueryBuilder`, `AnilistMapper` | **TDD** (or AI-spec-first hybrid) | You fully control the spec. Writing the test first is cheap because input/output shape is obvious. AI excels at "make this failing test pass." |
| **Repository** — `MediaRepository` | **Spec-first hybrid** | You control the schema and query shape, but AI needs the schema to write correct SQL. Write a one-paragraph spec, let AI generate code + tests together, then verify tests assert real behavior. |
| **External integrations** — `AnilistClient`, `CoverStorage` | **Test-after with captured fixtures** | The spec is owned by the external service (AniList, R2). You don't know the actual response shape until you call it. Build the integration, capture a real response as a JSON fixture, then write tests against the fixture. |
| **Worker handlers** (Hono routes) | **Test-after; integration via vitest-pool-workers** | Routing + middleware + DB binding composition; not testable as units. Exercise end-to-end. |
| **React components** | **Skip in v1** | UI churn rewrites every component 3-5 times in the first 2 months; component tests calcify against current implementation. Reintroduce at v2 when patterns stabilize, via Playwright e2e for 3-5 core flows. |

---

## The deeper principle

**TDD shines when you fully own the spec.** When the spec is partly external (an API's response, a library's behavior, a UI's pixel arrangement), test-after with captured fixtures gives you ground truth before writing assertions. Writing tests against guessed external shapes is brittle and frequently wrong.

---

## Modules and test priority for v1

| Priority | Module | Test type | Effort |
|---|---|---|---|
| 1 | `TitleDisplay` | Unit (pure) | ~15 min |
| 1 | `FilterQueryBuilder` | Unit (pure) | ~30 min |
| 1 | `AnilistMapper` | Unit (pure) with captured AniList fixture | ~30 min |
| 2 | `MediaRepository` | Integration via vitest-pool-workers + real D1 | ~1-2 hours |
| 3 | `AnilistClient` | Integration with mocked `fetch` returning captured responses | ~1 hour |
| 4 | `CoverStorage` | Integration with mocked R2 binding + mocked upstream fetch | ~1 hour |

**Priority 1** = before the corresponding feature ships.
**Priority 2-4** = as you finish each module, before moving to the dependent phase.

---

## What "good" looks like

A good test:

- Asserts **external behavior** (return value, HTTP status code, side effect on DB) — never implementation details (which internal helper got called, which intermediate variable looks a certain way)
- Has **one logical assertion per test** (localizes failure precisely)
- Uses **real DB** (in-memory or via vitest-pool-workers) instead of mocked DB
- Mocks **only at external boundaries** — AniList API endpoint, upstream image URL — never internal modules
- Can be read in 30 seconds and **you can verify by eye** that input → expected output is correct
- **Fails if the underlying implementation is wrong.** This is the single most important property — see anti-patterns below

---

## Anti-patterns — DO NOT do these

### Test-level

| Anti-pattern | Why it's bad |
|---|---|
| **Mock the database** | Mocked DB tests pass while real SQL queries fail. LIKE semantics, ORDER BY collation, foreign-key cascades on `media_video_parts` deletes — all silently broken by mocks |
| **Snapshot tests as default** | They "pass" until nobody trusts them; eventually you blanket-accept changes and they protect nothing |
| **Mock internal modules** | Mock only at edges; internal modules get exercised, not stubbed |
| **React component tests in v1** | UI churn invalidates them before they earn their maintenance cost |
| **Add `--coverage` flags or coverage thresholds** | Not for v1. See coverage policy below |

### AI-era specifically — tests that look like they assert but don't

| Pattern | Why it's bad |
|---|---|
| `expect(result).toBeDefined()` | The function returned *something*. Useless. |
| `expect(fn).not.toThrow()` (when not specifically testing crash behavior) | Didn't crash. Useless. |
| `expect(mock).toHaveBeenCalled()` (without verifying call args + return value) | The mock was hit. Doesn't verify behavior. |
| Tests that pass identically whether the function returns the right answer or the wrong one | Pure theatre |
| Tests with no meaningful expected value (e.g. `expect(result).toEqual(result)`) | Tautology |

**Reviewer rule:** read every AI-generated test. **If you can imagine the underlying function returning a wrong value AND the test still passing, the test is wrong.** Push back on the AI to make the test stricter.

---

## Coverage policy

| Phase | Stance |
|---|---|
| v1 build (weeks 1-4) | **Don't track.** Tests written per the priority order naturally cover what matters |
| Dogfood (weeks 5-8) | **Don't track.** If you catch a regression in real use, write a test for that specific failure |
| v2 features (month 3+) | Coverage as **report only**, never as a CI gate. Use it to spot untested modules you're about to extend |
| External users join | Consider CI gate at 60-70% on backend modules; never on frontend |

**Never set a coverage % target.** It pushes AI (and humans) to write tests for trivial getters while skipping the hard cases — and AI is unusually good at writing tests that hit coverage lines without asserting meaningful behavior.

---

## Workflow for Claude Code agents implementing this project

When asked to add a feature, follow this checklist:

1. **Identify the module class** from the table above. The strategy follows from the class.
2. **Apply the strategy:**
   - Pure function → write the test first (or AI-generate test + code together)
   - Repository → write a spec paragraph, AI generates code + tests
   - External integration → build, capture upstream response as fixture, write tests against fixture
   - Worker handler → build, then integration test via vitest-pool-workers
   - React component → no tests in v1
3. **Use real D1** via vitest-pool-workers for any DB code. **Never mock the database.**
4. **Mock only at external boundaries** — AniList GraphQL endpoint, upstream image fetch URL. Internal modules are exercised, not stubbed.
5. **Read every test you write.** Verify that each test would catch a wrong implementation, not merely an absent one. If you can mentally substitute a wrong return value and the test still passes, rewrite the test.
6. **Do not add coverage tracking.** Do not add `--coverage` flags, do not set `coverage.thresholds` in vitest config, do not gate CI on coverage.
7. **Do not write tests for React components in v1.** If you're tempted, defer to v2 and add a note instead.

---

## Prior art

The sister project `D:/Projects/java-knowledge-flashcard` on this dev machine uses Vitest in the same stack — reuse its config patterns where they fit.
