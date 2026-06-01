# 09 — Sorting & Searching Algorithms

> Classic CS-fundamentals coverage for the coding/screen portion. I'm a 6-year backend engineer, so I've *used* these via libraries for years — this note is about being able to **explain the trade-offs, complexity, and when to reach for each**, and to implement binary search cleanly under pressure. Mapped to Java/Python where it helps.

---

## ⚡ Complexity cheat strip (glance-before-the-room)

| Operation | Time | Notes |
|---|---|---|
| Hash lookup (`dict`/`set`, `HashMap`) | **O(1)** avg, O(n) worst | default "make it faster" |
| Binary search / balanced-tree / B-tree op | **O(log n)** | needs **sorted** input |
| Array scan / linear search | **O(n)** | unsorted fallback |
| Good comparison sort (quick/merge/heap/Timsort) | **O(n log n)** | can't beat this by comparing |
| Nested loops / bubble / insertion (worst) | **O(n²)** | avoid in real code |
| Brute-force combinatorics | O(2ⁿ) / O(n!) | red flag — find structure |

| Sort | Avg / Worst | Space | Stable? | Reach for it when |
|---|---|---|---|---|
| **Quicksort** | n log n / **n²** | O(log n) | ❌ | fastest in practice, in-place |
| **Mergesort** | n log n / n log n | **O(n)** | ✅ | need stable / linked list / external |
| **Heapsort** | n log n / n log n | O(1) | ❌ | guaranteed n log n + in-place |
| **Insertion** | n² / n² | O(1) | ✅ | tiny or nearly-sorted input |
| **Timsort** *(Java objects, Python `sorted`)* | n log n / n log n | O(n) | ✅ | **the real-world default** |

**Search defaults:** sorted → **binary search** (O(log n)); membership → **hash set** (O(1)); shortest path unweighted → **BFS**; deep explore/cycles → **DFS**. **Backend tie-in:** B-tree index = O(log n) seek vs O(n) scan; RAG vector search = **ANN/HNSW** (sub-linear nearest-neighbour).

---

## 1. Big-O — the language of the conversation

**Big-O** describes how runtime (or memory) **grows as input size `n` grows** — the worst-case asymptotic upper bound. Interviewers want you to *state the complexity of everything you write.*

| Notation | Name | Example |
|---|---|---|
| **O(1)** | constant | hash map lookup, array index |
| **O(log n)** | logarithmic | binary search, balanced BST op |
| **O(n)** | linear | scan an array once |
| **O(n log n)** | linearithmic | good comparison sorts (merge/quick/heap/Timsort) |
| **O(n²)** | quadratic | nested loops, bubble/insertion sort |
| **O(2ⁿ) / O(n!)** | exponential / factorial | brute-force combinatorics |

- **Time vs space:** always consider both. Mergesort is O(n log n) time but O(n) *extra space*; quicksort is O(n log n) time, O(log n) space.
- **Average vs worst case:** quicksort is O(n log n) average but **O(n²) worst case** (bad pivots) — a classic gotcha.
- **Amortized:** a single op can be slow but the *average over many* is fast (e.g. dynamic array append is amortized O(1) despite occasional resizes).

> **Backend framing:** this is the same reasoning as "is this query O(n) table scan or O(log n) index seek?" A DB **B-tree index** is literally a search-tree giving O(log n) lookups instead of an O(n) full scan — I think about this every time I add an index.

---

## 2. Sorting algorithms

### 2.1 The comparison-sort lower bound
Any sort that works by **comparing pairs** of elements cannot beat **O(n log n)** in the worst case. To go faster you need non-comparison sorts that exploit structure (§2.3).

### 2.2 The comparison sorts to know

| Algorithm | Avg | Worst | Space | Stable? | One-line "why/when" |
|---|---|---|---|---|---|
| **Quicksort** | O(n log n) | **O(n²)** | O(log n) | No | Fastest in practice; in-place; partition around a pivot. Worst case on bad pivots → mitigate with random/median pivot. |
| **Mergesort** | O(n log n) | O(n log n) | **O(n)** | **Yes** | Guaranteed n log n + stable; great for linked lists & external/large data; downside is extra memory. |
| **Heapsort** | O(n log n) | O(n log n) | O(1) | No | In-place + guaranteed n log n; uses a heap; slower constants, poor cache locality. |
| **Insertion** | O(n²) | O(n²) | O(1) | Yes | Tiny or nearly-sorted inputs; O(n) on almost-sorted data; used inside hybrid sorts for small chunks. |
| **Bubble/Selection** | O(n²) | O(n²) | O(1) | Bubble: yes | Teaching only — never use in real code. |

**Key terms:**
- **Stable** — equal elements keep their original relative order. *Matters when sorting by a secondary key* (sort by name, then stably by age → ages grouped, names ordered within). **Mergesort & insertion are stable; quicksort & heapsort are not.**
- **In-place** — sorts using O(1)/O(log n) extra space (quick, heap, insertion) vs needing O(n) (merge).

**What real languages actually use (great to know):**
- **Java:** `Arrays.sort()` on **primitives** → **dual-pivot quicksort**; on **objects** → **Timsort** (stable). `Collections.sort()` → Timsort.
- **Python:** `sorted()` / `list.sort()` → **Timsort** (hybrid of mergesort + insertion, stable, O(n) on sorted data).
- **Timsort** = the practical winner: stable, adaptive (fast on partially-sorted real-world data), O(n log n) worst case.

### 2.3 Non-comparison sorts (beat n log n by exploiting structure)
- **Counting sort** — O(n + k) where k = value range. For small integer ranges (e.g. ages 0–120). Stable.
- **Radix sort** — O(d·(n + k)), sorts digit by digit. Fixed-width integers/strings.
- **Bucket sort** — distribute into buckets, sort each. Good for uniformly distributed floats.
- **Trade-off:** these need assumptions about the data (bounded range, fixed width) and often extra memory — not general-purpose.

> **My honest framing:** "In production I call the library sort — Timsort in Python and Java — because it's stable, adaptive, and battle-tested. I can implement quicksort or mergesort and explain *why* the standard library chose Timsort, but I wouldn't hand-roll a sort in real code."

---

## 3. Searching algorithms

### 3.1 Linear search — O(n)
Scan until found. Works on **unsorted** data. The fallback when there's no structure to exploit.

### 3.2 Binary search — O(log n) — *know this cold; it's the #1 asked*
Requires **sorted** input. Repeatedly halve the search range.

```python
def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:                      # <= is critical (single-element range)
        mid = lo + (hi - lo) // 2        # avoids integer overflow vs (lo+hi)//2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            lo = mid + 1                 # discard left half
        else:
            hi = mid - 1                 # discard right half
    return -1                            # not found
```

**The bugs interviewers watch for:**
- `lo <= hi` vs `lo < hi` (off-by-one → misses the last element).
- `mid = lo + (hi - lo)//2` not `(lo+hi)//2` (overflow safety — matters in Java/C; idiom even in Python).
- Updating to `mid + 1` / `mid - 1`, not `mid` (infinite loop).

**Variants worth knowing:** first/last occurrence of a duplicate, **"binary search on the answer"** (search a value space, not an array — e.g. "minimum capacity to ship in D days"), and search in a rotated sorted array.

- **Java:** `Arrays.binarySearch()` / `Collections.binarySearch()`.
- **Python:** the `bisect` module (`bisect_left` / `bisect_right`).

### 3.3 Hash-based lookup — O(1) average
A **hash table** (Python `dict`/`set`, Java `HashMap`/`HashSet`) gives **average O(1)** insert/lookup — worst case O(n) on pathological collisions. **The default answer to "make this lookup faster"** when you don't need ordering. Trade memory for speed.

### 3.4 Tree & graph search
- **BST search** — O(log n) on a *balanced* tree, O(n) if degenerate. Real DBs use **B-trees/B+-trees** (the index structure) for this.
- **BFS** (breadth-first, queue) — shortest path in *unweighted* graphs; level-by-level. O(V + E).
- **DFS** (depth-first, stack/recursion) — explore deep; cycle detection, topological sort. O(V + E).
- **Dijkstra** — shortest path in *weighted* graphs (good to name, rarely need to implement).

> **Backend/SQL framing:** "Indexed lookup vs full scan is binary-search-vs-linear-search in disguise — a B-tree index turns an O(n) scan into O(log n). A hash index is the O(1) lookup. I make this trade every time I design a schema." This connects algorithms to work I've actually done, which lands better than reciting theory.

---

## 4. Common interview patterns (recognize these fast)

- **Two pointers** — sorted array, pair-sum, dedupe in place. O(n).
- **Sliding window** — longest/shortest subarray meeting a condition. O(n).
- **Binary search on the answer** — when the answer is monotonic over a range.
- **Hash map for O(1) lookup** — "have I seen this before?" / two-sum. Trade space for time.
- **Sort first, then scan** — many problems collapse to O(n log n) + O(n) once sorted.
- **Heap / priority queue** — top-k, merge k sorted lists, streaming median.

> **Tie to my AI work:** RAG's **vector search** is a search problem too — exact nearest-neighbour is O(n) per query, so production uses **approximate nearest neighbour (ANN / HNSW)** to get sub-linear search over millions of embeddings. Same "exploit structure to beat the naive scan" instinct as binary search. *(See file 04.)*

---

## 5. Likely interview questions + model answers

**Q1. "Implement binary search."**
> *(Write the snippet in §3.2.)* "It requires sorted input and runs in O(log n). The three things I'm careful about: the loop condition is `lo <= hi` so I don't miss a single-element range; I compute mid as `lo + (hi - lo) // 2` to avoid overflow, which is a habit from Java; and I move the bound past mid each step so it can't loop forever."

**Q2. "Quicksort vs mergesort — when would you pick each?"**
> "Both are O(n log n) average. Quicksort is usually faster in practice, sorts in place with O(log n) space, but has an O(n²) worst case on bad pivots and isn't stable — you mitigate the worst case with a random or median-of-three pivot. Mergesort guarantees O(n log n) and is stable, which matters when sorting by a secondary key, and it's natural for linked lists or data too big for memory — but it needs O(n) extra space. In reality I'd use the library sort: Java and Python both use Timsort for objects, which is stable, adaptive to partially-sorted data, and O(n log n) worst case."

**Q3. "What does 'stable sort' mean and why care?"**
> "A stable sort keeps equal elements in their original relative order. It matters for multi-key sorting: if I sort records by name, then stably sort by department, I get departments grouped with names still ordered within each. Mergesort and insertion sort are stable; quicksort and heapsort aren't, which is why Java uses Timsort for objects where stability is expected."

**Q4. "You need to check membership millions of times — what structure?"**
> "A hash set — average O(1) lookups, versus O(n) for a list scan or O(log n) for a sorted array with binary search. I'm trading memory for speed, and I'd accept the rare worst-case collision cost. If I also needed ordering or range queries, I'd use a sorted structure or a tree instead, accepting O(log n)."

**Q5. "How is this relevant to backend / AI work you've done?"**
> "Constantly, just abstracted behind libraries and databases. A B-tree index is binary search on disk — O(log n) seeks instead of an O(n) scan — which I reason about every time I add an index or look at a query plan. And in the AI project, vector search for RAG is a nearest-neighbour search problem: naive is O(n) per query, so production uses approximate nearest-neighbour indexes to make it sub-linear. The instinct is the same: exploit structure to beat the naive scan."

**If I'm asked something I don't recall** (e.g. implement red-black tree rotations, prove a complexity bound):
> "I don't have the rotation cases memorized — I'd reach for the standard library's balanced tree in real code. I can tell you the *properties* it guarantees and why — O(log n) balanced operations — and reason from there." Honest; pivot to what you'd actually do.

---

## 6. Rapid-fire facts to memorize

- **Comparison sorts can't beat O(n log n)** worst case.
- **Quicksort:** O(n log n) avg, **O(n²) worst**, in-place, not stable.
- **Mergesort:** O(n log n) always, O(n) space, **stable**.
- **Heapsort:** O(n log n) always, in-place, not stable.
- **Timsort** (Java objects / Python `sorted`): stable, adaptive, O(n log n) worst.
- **Binary search:** O(log n), **needs sorted input**; `lo<=hi`, overflow-safe mid.
- **Hash lookup:** O(1) avg, O(n) worst; default for fast membership.
- **BFS** = shortest path unweighted (queue); **DFS** = deep explore (stack/recursion).
- **B-tree index = O(log n) search**; full scan = O(n). (The backend tie-in.)
- **ANN/HNSW** = sub-linear approximate nearest-neighbour for vector search (RAG).
