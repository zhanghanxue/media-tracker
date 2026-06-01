# 02 — ML / NLP Fundamentals

> For a strong backend engineer newer to ML. Enough to hold a credible conversation and connect every concept back to my project. I am **not** claiming research depth — I'm claiming I understand the building blocks of the model I shipped.

---

## 1. Supervised learning in one screen

**Supervised learning** = learn a function from **labelled examples** `(input → correct output)` so it generalizes to unseen inputs.

- **My project:** banking77 gives me 10,003 `(ticket text → intent label)` pairs. The model learns to map new ticket text to one of 77 intents.
- **Classification** (my case) = predict a **category** (1 of 77). **Regression** = predict a **number** (e.g. house price).
- **Training** = show the model examples, measure how wrong it is (**loss**), nudge its parameters to be less wrong (**gradient descent / backprop**), repeat.
- **Loss function** = the number we minimize. Mine is **weighted cross-entropy** (penalizes confident wrong answers; the weights handle class imbalance — see file 03).

> **Spring analogy:** training is like fitting a config from data instead of hand-writing `if/else` rules. The model's **weights** are 67M learned parameters; you don't write them, gradient descent does. Inference is then just a pure function `f(text) → label`, the same way a `@Service` method is a pure-ish function once it's wired up.

---

## 2. Tokenization — turning text into numbers

Models don't see text; they see **integers**. **Tokenization** splits text into **tokens** (subword chunks) and maps each to an ID.

- DistilBERT/BERT use **WordPiece**: common words = one token, rare words split into pieces. `"unhappiness" → ["un", "##happiness"]` or `"##happy", "##ness"`.
- **Why subwords?** Fixed vocabulary (~30k tokens) can represent *any* word, including typos and unseen words, without an "unknown" black hole.
- Special tokens: `[CLS]` (start; its final embedding represents the whole sentence for classification), `[SEP]` (separator), `[PAD]` (padding to equal length).

**In my project:** I never call the tokenizer by hand in the live service — the `transformers` **`pipeline`** does tokenization → inference → softmax internally (`prediction.py:42`). During **training** I used `AutoTokenizer.from_pretrained(...)` to pre-tokenize the dataset (banking77 notebook). The model and tokenizer are a **matched pair** — you must use the tokenizer the model was trained with, or the IDs are meaningless.

> **Key term — `AutoTokenizer`:** HF's factory that loads the right tokenizer for a model name. `AutoModelForSequenceClassification` is the matching factory for the model head. "Auto" = "figure out the architecture from the checkpoint name."

---

## 3. Embeddings — meaning as vectors

An **embedding** is a dense vector (list of floats) representing a token/word/sentence such that **similar meanings are close together** in vector space.

- `"card"` and `"debit card"` end up near each other; `"card"` and `"weather"` far apart.
- Distance is usually **cosine similarity**.
- Early embeddings (Word2Vec/GloVe) were **static** — one vector per word regardless of context. Transformers produce **contextual** embeddings — `"bank"` in "river bank" vs "bank account" gets *different* vectors.

**In my project:** DistilBERT turns each ticket into contextual embeddings; the `[CLS]` token's final embedding is fed to a small classification head (a linear layer) that outputs 77 scores. **Embeddings are also the foundation of RAG / vector search** (file 04) — that's the bridge if asked "how would you add semantic search?"

> **Spring analogy:** an embedding is like a hash that preserves *meaning* instead of being random — close inputs → close outputs, so you can do "nearest neighbour" lookups on semantics, not exact keys.

---

## 4. Transformers & attention (high level — don't overclaim)

The **Transformer** (2017, "Attention Is All You Need") is the architecture behind BERT, GPT, Mistral — basically all modern NLP.

**The one idea that matters: self-attention.**
- For each token, attention lets the model **look at every other token in the input and decide which ones are relevant** to interpreting it.
- "The card I *lost* yesterday isn't *working*" — attention links "lost" and "card" and "working" so the model understands the relationship, regardless of distance.
- It does this with learned **Query / Key / Value** projections: each token emits a query, compares it against every token's key, and takes a weighted sum of values. The weights are the "attention."
- **Multi-head attention** = several attention computations in parallel, each learning a different kind of relationship (syntax, coreference, etc.).

**Why it beat RNNs/LSTMs:** RNNs process tokens **sequentially** (slow, forget long-range context). Transformers process **all tokens in parallel** and connect any two positions directly — faster on GPUs and better at long-range dependencies.

**Two families** (important distinction):
- **Encoder-only (BERT, DistilBERT)** — sees the *whole* sentence at once (bidirectional). Great for **understanding/classification**. ← *my classifier.*
- **Decoder-only (GPT, Mistral)** — predicts the *next* token left-to-right. Great for **generation**. ← *my LLM.*

> **If asked to go deeper than this:** *"I understand attention at the level of 'every token attends to every other token via query/key/value, in parallel across heads,' and why that beats sequential RNNs. I haven't implemented attention from scratch — my depth is in deploying these models, not authoring the architecture."* Honest, and it lands fine.

---

## 5. BERT vs DistilBERT — what they actually are

- **BERT** (Bidirectional Encoder Representations from Transformers) — an **encoder-only** transformer pre-trained on huge text via **masked language modelling** (hide ~15% of words, predict them) so it learns deep bidirectional language understanding. You then **fine-tune** it on your task.
- **DistilBERT** — a **distilled** (compressed) BERT: a smaller "student" model trained to mimic BERT the "teacher." **~40% smaller, ~60% faster, retains ~97% of BERT's performance.**

**Why I chose DistilBERT:** I'm deploying on **free CPU** (HF Spaces, no GPU). DistilBERT's speed/size is the difference between a usable demo and a timeout. The small accuracy give-up vs BERT is worth it for a triage classifier. 67M params, loads in-process.

> **Knowledge distillation in one line:** train a small model to reproduce a big model's outputs — you keep most of the quality at a fraction of the cost. This is the same instinct as my "use the cheap specialist where you can" design decision.

---

## 6. Fine-tuning vs prompting vs training-from-scratch

| Approach | What it is | Cost | When | My project |
|---|---|---|---|---|
| **Training from scratch** | Random weights → train on massive data | $$$$, months, huge data | Almost never (only if you're OpenAI/Meta) | ❌ Never did this |
| **Fine-tuning** | Take a pre-trained model, continue training on *your* labelled data | $ (hours on one GPU) | You have labelled data + a fixed task | ✅ DistilBERT on banking77 |
| **Prompting** | Don't train at all — give a pre-trained LLM instructions at inference time | ~free (just API calls) | Flexible tasks, no training data, fast iteration | ✅ How I use Mistral-7B |

- **Fine-tuning** updates the model's weights. My classifier *learned* the 77 banking intents — that knowledge is baked into `zhanghanxue/banking77-weighted-classifier`.
- **Prompting** changes nothing in the model; I just craft the input. My agent's system prompt (`react_agent.py:24`) tells Mistral how to behave *per request*.
- **Zero-shot** = prompt with no examples. **Few-shot** = prompt with a handful of examples inline. (Not the same as fine-tuning — no weights change.)
- **PEFT / LoRA** (good term to know): fine-tune only a tiny set of extra parameters instead of all of them — cheap fine-tuning of big models. *I didn't use it* (DistilBERT is small enough to fully fine-tune), but it's the modern way to fine-tune 7B+ models.

> **My honest framing:** "I've done full fine-tuning of a small encoder, and I use prompting for the LLM. I haven't done LoRA or RLHF — I know what they are and when I'd reach for them."

---

## 7. Likely interview questions + model answers

**Q1. "What's the difference between BERT and an LLM like GPT/Mistral?"**
> "BERT is encoder-only and bidirectional — it reads the whole input at once and is built for *understanding* tasks like classification, which is exactly what my DistilBERT does. GPT and Mistral are decoder-only — they predict the next token left-to-right, which makes them generators. In my system I use both for what each is good at: the encoder classifies the ticket, the decoder writes the response."

**Q2. "What is tokenization and why does it matter?"**
> "It's converting text into integer IDs the model can process, using subword units so any word — even typos or unseen words — can be represented from a fixed ~30k vocabulary. It matters operationally because the tokenizer and model are a matched pair: in my service the transformers pipeline tokenizes with the exact tokenizer the model was fine-tuned with, otherwise the IDs would be meaningless. It also matters for cost and limits — LLM pricing and context windows are measured in tokens, not words."

**Q3. "Explain attention in plain English."**
> "For each word, the model looks at every other word in the sentence and weighs how relevant each is to interpreting that word. So in 'the card I lost isn't working,' it can link 'lost,' 'card,' and 'working' even though they're far apart. It does all positions in parallel, which is why transformers replaced sequential RNNs — faster on GPUs and better at long-range context."

**Q4. "Why fine-tune DistilBERT instead of just prompting an LLM to classify?"**
> "Three reasons: a fine-tuned classifier is more accurate on my 77 fixed domain intents than a general LLM doing zero-shot; it's free and fast because it runs in-process on CPU, no per-call cost; and it gives me a stable confidence score I can threshold on for the urgency rule. Prompting an LLM is the right tool when the task is open-ended or I have no training data — which is why I *do* prompt the LLM for the response-generation step."

**Q5. "What's the difference between fine-tuning and prompting?"**
> "Fine-tuning actually updates the model's weights on your labelled data, so the knowledge is permanent and baked into the model file. Prompting changes nothing in the model — you just craft the input at inference time. Fine-tuning needs data and a training run; prompting is instant but you're renting a general model's behaviour each call. My project uses both: fine-tuned classifier, prompted LLM."

**If I'm asked something I don't know** (e.g. "derive backprop," "explain positional encodings in detail"):
> "I don't have that at my fingertips — I've used these models as a practitioner, not implemented the internals. I can tell you the *why* at a systems level and reason from there." Then pivot to what you know.

---

## 8. Terms to be able to define in one line

- **Token** — a subword unit; the atomic input to the model.
- **Embedding** — a vector encoding meaning; similar things are close.
- **Attention** — each token weighs every other token's relevance.
- **Encoder / decoder** — understanding (BERT) vs generation (GPT/Mistral).
- **Pre-training** — generic language learning on huge unlabelled text.
- **Fine-tuning** — continuing training on your labelled task data.
- **Prompting / zero-shot / few-shot** — steering a frozen model via the input.
- **Distillation** — small model mimics big model (DistilBERT).
- **LoRA/PEFT** — cheap fine-tuning of a few extra params.
- **Logits → softmax** — raw scores → probabilities that sum to 1 (my confidence score).
