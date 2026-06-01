# 03 — Model Training & Evaluation

> The "how did you actually train and validate your model" file. Grounded in my real banking77 notebook. I trained **one** classifier — I know this run cold.

---

## 1. The fine-tuning workflow (my actual pipeline)

The Hugging Face fine-tuning flow is four moving parts. Here's mine, in order:

```python
# 1. Tokenizer — turn text into model-ready IDs (matched to the base model)
tokenizer = AutoTokenizer.from_pretrained("distilbert-base-uncased")

# 2. Model — load pre-trained DistilBERT + a fresh 77-class classification head
model = AutoModelForSequenceClassification.from_pretrained(
    "distilbert-base-uncased", num_labels=77, id2label=id2label, label2id=label2id
)

# 3. TrainingArguments — all the knobs (hyperparameters, eval/save strategy)
training_args = TrainingArguments(
    learning_rate=2e-5, per_device_train_batch_size=16,
    num_train_epochs=3, weight_decay=0.01,
    eval_strategy="epoch", save_strategy="epoch",
    load_best_model_at_end=True, metric_for_best_model="f1",
)

# 4. Trainer — the training loop engine (I subclassed it, see §3)
trainer = WeightedTrainer(model=model, args=training_args,
    train_dataset=..., eval_dataset=..., compute_metrics=compute_metrics)
trainer.train()
```

**What each piece does:**
- **`AutoTokenizer`** — loads the tokenizer matched to the base model; I pre-tokenized the dataset with it.
- **`AutoModelForSequenceClassification`** — loads pre-trained DistilBERT *body* + bolts on a **new, randomly-initialized classification head** sized to `num_labels=77`. (The HF warning "some weights are newly initialized — you should TRAIN this model" is *expected* — that's the head I'm about to fine-tune.)
- **`id2label` / `label2id`** — the mapping between integer class IDs and human labels (e.g. `0 → activate_my_card`). Baked into the model config so `/predict` returns readable labels, not "37".
- **`TrainingArguments`** — declarative config for the run: learning rate, batch size, epochs, weight decay, and **`load_best_model_at_end=True` + `metric_for_best_model="f1"`** so it keeps the best checkpoint by F1, not just the last one.
- **`Trainer`** — HF's training loop: batching, forward pass, loss, backprop, optimizer step, eval, checkpointing. I don't write the loop.

> **Spring analogy:** `TrainingArguments` is your `application.yml` — declarative config separated from logic. `Trainer` is a framework that owns the lifecycle (like Spring Batch owns a job's read/process/write loop); I just supply data, model, and a metrics callback.

**My run:** 3 epochs, lr 2e-5, batch 16, ~7m45s on a Colab GPU, final train loss 1.94.

---

## 2. Train / validation / test split — and why

- **Train** — the model learns from this (banking77: 10,003 examples).
- **Validation** — checked *during* training to pick the best checkpoint and tune hyperparameters. The model never trains on it.
- **Test** — touched **once, at the end**, to estimate real-world performance (banking77: 3,080 examples, 40 per class).

**Why separate them:** if you evaluate on data the model trained on, you measure memorization, not generalization — flattering and useless. The test set is your honest estimate.

> **Honesty note for my project:** banking77 ships as train/test. In my notebook I used the **test set as the eval set during training** (`eval_dataset=tokenized_datasets["test"]`). That technically means the test set influenced checkpoint selection — a small methodological leak. The clean version uses a *separate* validation split and keeps test untouched. **Good thing to volunteer** — it shows I understand the principle even where my notebook took a shortcut.

---

## 3. Class imbalance & weighted banking77 (my signature decision)

**The problem:** banking77's classes aren't equal — some intents have many more training examples than others. A naive model can get high accuracy by just being good at common classes and **ignoring rare ones** — which is dangerous when a rare class is `fraudulent_transaction`.

**My fix — class weighting:**
```python
class_weights = compute_class_weight("balanced", classes=np.unique(train_labels), y=train_labels)
# weights ranged 0.695 (common classes) → 3.712 (rare classes)
```
I then subclassed `Trainer` into a **`WeightedTrainer`** that overrides `compute_loss` to use `CrossEntropyLoss(weight=class_weights)` — so **mistakes on rare classes cost more**, forcing the model to pay attention to them.

```python
class WeightedTrainer(Trainer):
    def compute_loss(self, model, inputs, return_outputs=False, **kw):
        labels = inputs.get("labels")
        outputs = model(**inputs)
        loss_fct = torch.nn.CrossEntropyLoss(weight=class_weights.to(outputs.logits.device))
        loss = loss_fct(outputs.logits.view(-1, 77), labels.view(-1))
        return (loss, outputs) if return_outputs else loss
```

**Trade-off:** up-weighting rare classes can slightly hurt majority-class precision (more false positives there) to gain minority **recall**. For triage, **catching the rare urgent ticket matters more** than perfect precision on common ones — a defensible product decision.

> **Other ways to handle imbalance** (know these): resampling (oversample rare / undersample common, e.g. SMOTE), data augmentation, or just collecting more rare-class data. I chose weighting because it needs no data changes and is one clean override.

---

## 4. Precision, Recall, F1 — the metrics that matter

Accuracy alone lies on imbalanced data. The honest metrics:

- **Precision** = of the tickets I *labelled* X, how many *were* X? (Low precision = false alarms.)
- **Recall** = of the tickets that *were* X, how many did I *catch*? (Low recall = missed cases.)
- **F1** = harmonic mean of precision & recall — one number balancing both. Harmonic mean punishes lopsidedness (great precision + terrible recall ≠ good).

**The trade-off, in my domain:**
- **Fraud detection wants high recall** — missing a fraud (false negative) is far worse than a false alarm.
- **Auto-blocking a card wants high precision** — you don't want to block legitimate customers.
- F1 is the compromise when both matter.

**Averaging across 77 classes:**
- **Macro avg** — simple average over classes; treats every class equally (good for spotting rare-class weakness). Mine: **0.87**.
- **Weighted avg** — average weighted by class size. Mine: **0.866** — this is the F1 I quote.

> **My results:** accuracy **86.7%**, weighted F1 **0.866**, macro F1 **0.87**. I evaluated with `sklearn.classification_report` for full **per-class** precision/recall/F1 — not just a headline accuracy. (README says "92%" — the notebook says 87%; I quote the notebook.)

---

## 5. Confusion matrix — where it actually fails

A **confusion matrix** is a grid of *actual* vs *predicted* class. The diagonal = correct; off-diagonal = the specific mistakes.

**Why it's gold:** it tells you *what gets confused with what*, not just that you're wrong.

**In my model, the weak classes were semantically overlapping intents:**
- `why_verify_identity` — F1 **0.48** (worst; confused with the other identity-verification intents).
- `topping_up_by_card` — F1 0.68 (confused with `top_up_by_card_charge`, `top_up_failed`).
- `verify_my_identity` — F1 0.69.

These aren't random errors — they're **genuinely ambiguous categories** that even a human would hesitate on. That's the honest, expected failure mode and a great thing to discuss: *the model's confusion mirrors real semantic overlap in the label taxonomy.*

---

## 6. Overfitting (and underfitting)

- **Overfitting** = model memorizes the training data, including noise — great train score, poor test score. It learned the answers, not the pattern.
- **Underfitting** = model too simple / undertrained — poor on both.
- **Signal:** train loss keeps dropping while validation loss starts *rising* = overfitting.

**How my setup guards against it:**
- **`weight_decay=0.01`** — L2 regularization, penalizes large weights.
- **`warmup_steps=100`** — ramps the learning rate up gently to stabilize early training.
- **`load_best_model_at_end` + `metric_for_best_model="f1"`** — keeps the checkpoint that generalized best (by validation F1), not the last/most-overfit one.
- **Only 3 epochs** — fine-tuning a pre-trained model needs few epochs; too many is a classic overfit cause.
- **Pre-training itself** — starting from DistilBERT (already knows language) means I need little data and little training, which limits overfitting.

> **Spring analogy:** overfitting is like a test suite that passes only because you hard-coded the expected outputs — green locally, broken in prod. The test set is your "staging environment" that catches it.

---

## 7. Likely interview questions + model answers

**Q1. "Walk me through how you fine-tuned your model."**
> "I loaded `distilbert-base-uncased` with a fresh 77-class head via `AutoModelForSequenceClassification`, tokenized banking77 with the matched `AutoTokenizer`, configured the run with `TrainingArguments` — lr 2e-5, batch 16, 3 epochs, weight decay, eval and save every epoch, keep the best checkpoint by F1 — and ran it through a `Trainer` I subclassed to apply class weights. About eight minutes on a Colab GPU. Final weighted F1 was 0.87."

**Q2. "Your data was imbalanced — how did you handle it, and why that way?"**
> "I computed balanced class weights with scikit-learn — they ranged from about 0.7 for common classes to 3.7 for rare ones — and subclassed the HF Trainer to inject those weights into the cross-entropy loss, so errors on rare classes cost more. I chose weighting over resampling because it needs no changes to the dataset and is a single clean override. The trade-off is slightly lower precision on common classes for better recall on rare ones — which is the right call when a rare class might be fraud."

**Q3. "Why F1 and not accuracy?"**
> "Accuracy is misleading on imbalanced data — you can score high by nailing common classes and ignoring rare ones. F1 balances precision and recall, so it exposes weak classes. I reported weighted F1 (0.866) for the overall picture and a full per-class report to see *where* it fails — which turned out to be semantically overlapping intents like the identity-verification categories."

**Q4. "How do you know it's not overfitting?"**
> "A few guards: weight decay for regularization, only three epochs since fine-tuning needs few, and `load_best_model_at_end` by validation F1 so I keep the checkpoint that generalized best rather than the last one. The real check is the gap between train and test performance — my held-out test F1 of 0.87 is consistent with training, so it's generalizing, not memorizing."

**Q5. "If you had more time, what would you improve in training?"**
> "Three things. First, use a proper separate validation split — in my notebook I evaluated on the test set during training, which slightly leaks it into checkpoint selection. Second, calibrate the confidence scores so my 0.7 urgency threshold is meaningful. Third, target the weak overlapping classes specifically — more data or merging genuinely-ambiguous intents — since that's where the per-class F1 dropped to 0.48."

**If I'm asked something I don't know** (e.g. learning-rate schedulers, optimizer math):
> "I used the HF defaults there — AdamW with a warmup — and didn't tune the scheduler deeply. I understand *why* warmup helps stabilize early training; I haven't swept those hyperparameters myself."

---

## 8. Numbers to memorize

- banking77: **77 classes**, 10,003 train / 3,080 test (40/class).
- Hyperparams: **lr 2e-5, batch 16, 3 epochs, weight_decay 0.01, warmup 100**.
- Results: **acc 86.7%, weighted F1 0.866, macro F1 0.87**, train loss 1.94, ~7m45s.
- Class weights: **0.695 → 3.712**.
- Worst class: `why_verify_identity` (**F1 0.48**). Best: several at **1.00**.
