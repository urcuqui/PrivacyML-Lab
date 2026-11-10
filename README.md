# Privacy-Preserving ML Lab

*Understanding Differential Privacy and Federated Learning through experimentation.*

An interactive, fully client-side teaching lab for postgraduate students in Machine Learning, AI and Cybersecurity. Students change parameters, run real simulations in the browser, inspect intermediate computations and compare runs. The aim is to understand **what Differential Privacy (DP) and Federated Learning (FL) protect, what they do not protect, and the trade-offs involved**. The goal is not to make these techniques look impressive.

![Demo of the Privacy-Preserving ML Lab: live Laplace sampler, step-by-step Laplace mechanism, centralised vs federated animation, FedAvg round inspector, combined A/B/C comparison and a knowledge-check question with feedback](docs/demo.gif)

*Demo (recorded from the production build, all values computed live in the browser): overview with a live Laplace sampler → Laplace mechanism step by step and repeated releases → centralised vs federated workflow → FedAvg round inspector → Centralised vs FL vs FL+DP comparison (ε shown only when the accountant applies) → knowledge check with per-option feedback.*

> **Resumen en español.** Laboratorio educativo interactivo (React + TypeScript) sobre Privacidad Diferencial y Aprendizaje Federado. Todo el contenido de la aplicación está en español. Se ejecuta íntegramente en el navegador, usa solo datos sintéticos, no necesita claves de API ni servidor, y funciona sin conexión una vez instaladas las dependencias. Cada experimento separa los cálculos reales, las garantías formales (bajo supuestos), las observaciones empíricas, los modelos simplificados y las ilustraciones conceptuales. Instalación: `npm install` y después `npm run dev`.

---

## Quick start

Requirements: **Node.js ≥ 18** (developed with Node 26 / npm 11).

```bash
npm install        # install dependencies (only network access ever needed)
npm run dev        # start the dev server → http://localhost:5173
npm test           # run the unit tests (Vitest)
npm run build      # type-check (tsc -b) and build the production bundle into dist/
npm run preview    # serve the production build locally
```

- No API keys, paid services or backend.
- No student data leaves the browser. Experiment history lives only in `localStorage`, and JSON/Markdown exports are generated client-side.
- Fonts are bundled from local `@fontsource` packages, so the app works offline after `npm install`.

---

## Companion notebook

[`notebooks/Privacy_Preserving_Machine_Learning_Hands_On.ipynb`](notebooks/Privacy_Preserving_Machine_Learning_Hands_On.ipynb) is a self-contained Jupyter notebook for a 90–120-minute guided session. It covers DP, FedAvg, Non-IID data, gradient leakage, DP aggregation, secure aggregation and agentic AI, using only NumPy, pandas, Matplotlib and scikit-learn, and is saved with its outputs. It does not need this web app. See [`notebooks/README.md`](notebooks/README.md) for how to run it.

## Architecture

```
src/
├── lib/                      # Computation engine: pure, strictly typed, unit-tested, UI-free
│   ├── rng/rng.ts            # Seeded PRNG (Mulberry32), Box–Muller normal, inverse-CDF Laplace, crypto RNG
│   ├── stats.ts  vec.ts      # mean/std/quantile/histogram/CI, vector ops, L2 clipping
│   ├── dp/
│   │   ├── laplace.ts        # Laplace mechanism, pdf/cdf, repeated simulation, privacy-loss function
│   │   ├── sensitivity.ts    # count / bounded sum / bounded mean sensitivities + stated assumptions
│   │   ├── composition.ts    # sequential-composition budget ledger, repeated-release experiment
│   │   ├── accountant.ts     # RDP accountant for composed Gaussian mechanism (no subsampling)
│   │   └── dpsgd.ts          # SGD vs DP-SGD for logistic regression with per-step traces
│   ├── ml/logistic.ts        # logistic regression, per-example gradients, SGD, synthetic blobs
│   ├── fl/
│   │   ├── data.ts           # synthetic "hospital" clients, IID / non-IID generation, global test set
│   │   ├── fedavg.ts         # FedAvg, DP-FedAvg (client-level), centralised baseline, round traces
│   │   ├── communication.ts  # payload-only communication-cost model
│   │   └── leakage.ts        # analytic gradient-inversion illustration for logistic regression
│   ├── tasks.ts              # Expensive sweeps/comparisons, all pure functions (the "backend boundary")
│   ├── useSimTask.ts         # React hook: runs a task in a Web Worker, falls back to the main thread
│   ├── store.ts              # shared persistent state (memory + localStorage) via useSyncExternalStore
│   ├── runs.ts  report.ts    # experiment runs/history, JSON export, Markdown educational report
│   ├── router.ts             # tiny hash router (#/dp/2), works offline without a server
│   └── glossary.ts           # Spanish glossary used by <Term> tooltips
├── workers/sim.worker.ts     # Web Worker that dispatches TASKS by name
├── components/
│   ├── ui/                   # shadcn/ui-style primitives built on Radix (button, slider, tabs, tooltip…)
│   ├── lab/                  # ExperimentLayout, IntegrityBadge, ParamControl, ShowCalculations,
│   │                         # RunTimeline, Reflection, ProsCons, Callout, Term…
│   └── charts/               # ChartFrame (accessible chart + "Ver datos" table), Recharts theme
├── modules/
│   ├── registry.ts           # experiment catalogue, routes and lazy-loaded pages
│   ├── overview/  journey/   # landing page and guided 7-stage learning journey
│   ├── dp/                   # Module 1: five DP experiments
│   ├── fl/                   # Module 2: five FL experiments
│   ├── combined/             # Module 3: centralised vs FL vs FL+DP
│   ├── quiz/                 # knowledge checks per module and the final practical challenge
│   ├── history/              # saved experiments, comparison, export
│   └── limits/               # "Lo que esta simulación NO demuestra"
└── test/                     # Vitest unit tests for the engine
```

**Stack:** React 18 + TypeScript (strict) + Vite 5, Tailwind CSS 3, shadcn/ui-style components on Radix primitives, Recharts, Framer Motion, Lucide icons, Vitest.

### Adding a Python backend later

The engine is split from the UI on purpose. Every expensive computation is a pure function in `src/lib/tasks.ts`, registered by name in `TASKS` and called through `runSimTask(name, payload)` (`src/lib/useSimTask.ts`). To add a backend (real ML training with PyTorch/Opacus, or advanced accounting with Google's `dp-accounting`):

1. Implement the same task names behind an HTTP endpoint (e.g. `POST /tasks/{name}`) that accepts and returns the same JSON-serialisable shapes (`TaskInput<K>` / `TaskOutput<K>`).
2. In `runSimTask`, route selected tasks to `fetch` instead of the worker.

Components stay unchanged. Under the project's privacy rules, any backend must be self-hosted and opt-in.

---

## Experiment catalogue

Every experiment uses the same layout: **Configuration** (left), **Interactive visualisation** (centre), **Observations** (right), and an **Experiment timeline** (bottom) for replaying, comparing, renaming, saving and exporting runs. Below that come **Ver cálculos** (equations, inputs, intermediate values, assumptions, outputs), benefits/limitations and a reflection question.

| Route | Experiment | What is actually computed |
|---|---|---|
| `/dp/1` | Why do we need privacy? | Exact count/mean on a fictional 5-person dataset, and on neighbouring datasets (remove/replace a target individual), shown side by side. |
| `/dp/2` | Laplace mechanism | True count, noisy release `count + Lap(1/ε)`, noise, absolute error, and the distribution over N seeded repetitions against the theoretical density. |
| `/dp/3` | Privacy vs utility | Empirical mean absolute error vs ε (with variability), release distributions for neighbouring datasets, privacy-loss ratio ≤ e^ε, bounded-mean sensitivity `(U−L)/n` and clamping bias. |
| `/dp/4` | Budget composition | Sequential-composition ledger with limit and over-budget warnings; one release vs the average of k releases (total cost k·ε). |
| `/dp/5` | DP-SGD | Logistic regression with SGD vs DP-SGD: per-example gradients, clipping, Gaussian noise, updates, loss/accuracy curves, contextual check on too-small clipping norms (with an on-demand C/10 run). Selectable adjacency; ε shown only when the accountant applies (add/remove: full batch; replacement: full or mini-batch), otherwise **"No calculado"** with the reason. |
| `/fl/1` | Centralised vs federated | Animated side-by-side flows of raw data vs model updates for three synthetic hospitals. |
| `/fl/2` | A FedAvg round | Step-by-step FedAvg (init → selection → local training → transmission → weighted aggregation → evaluation). All parameters come from the live simulation. |
| `/fl/3` | IID vs non-IID | Same FedAvg configuration under both regimes over repeated seeds, evaluated on **each scenario's own distribution and on a common, fixed reference population**; global/per-client accuracy, convergence, loss and variability, with computed verdicts for both evaluations. |
| `/fl/4` | Communication costs | Bytes per round and in total; a grid over local epochs × participation measuring the rounds, bytes and gradient evaluations needed to reach a target test loss (default) or accuracy; extrapolation to larger reference models. |
| `/fl/5` | Privacy limits of FL | Analytic gradient inversion for logistic regression (exact for one example, residual-weighted mean for a batch), optionally with noise. Includes a conceptual panel on secure aggregation, DP and TEEs/access control. |
| `/combined` | FL with DP | Controlled comparison: A centralised, B1 weighted FedAvg, B2 uniform FedAvg, C uniform + clipping (not DP), D client-level DP-FedAvg repeated over noise seeds — same data, selection and local training. Waterfall decomposition of the accuracy gap into weighting, clipping and noise; privacy model card (adjacency, trust model: external observers vs server); σ × C sweep with both baselines; conceptual secure-aggregation mode. |
| `/quiz/{dp,fl,combined}` | Knowledge checks | 5 applied-reasoning questions per module, each option with its own explanation. Numeric questions are computed with the engine functions. |
| `/quiz` | Final challenge | Three fictional organisations (hospital network, mobile keyboard, statistics agency) with explicit accuracy, privacy and communication requirements; rule-based feedback per requirement (meets / partially / fails) plus a reasoned discussion. |
| `/journey` | Guided journey | Seven stages from "the privacy problem" to "final decision", plus an optional eighth stage on agentic AI. Experiment state persists as you move between stages. |
| `/agentic` | Beyond the model: privacy in agentic AI | Conceptual, deterministic, rule-based simulation (no LLM) with synthetic patients: (1) what FL + DP protect, (2) agent memory policies and cross-user leakage, (3) a prompt-injection-driven tool exfiltration attempt with toggleable controls; the DP toggle provably never changes the outcome. Takeaway: model-level privacy does not imply system-level privacy. |

## Methodology and scientific integrity

Each experiment follows **Observe → Understand → Configure → Execute → Inspect → Compare → Reflect**. A concrete example comes first, then the notation.

Results carry an integrity label:

| Label | Meaning |
|---|---|
| **Cálculo real** | Computed live in the browser from the current parameters. Nothing is precomputed. |
| **Simulación educativa** | Real mechanisms in a deliberately simplified setting (tiny model, synthetic data). |
| **Garantía formal bajo supuestos** | A proven bound that holds only if every listed assumption holds. |
| **Observación empírica** | Measured over seeded repetitions. Depends on data and configuration. Not a guarantee. |
| **Ilustración conceptual** | A visual explanation, not an implementation or a measurement. |
| **No calculado** | No valid method is implemented for this configuration, so no number is shown. |

The lab never invents metrics or ε values. Seeded randomness is labelled as a reproducibility feature, not as private randomness.

---

## Mathematical assumptions

All privacy assumptions are centralised in [`src/lib/privacy/model.ts`](src/lib/privacy/model.ts): the **privacy unit** (record or client), the **adjacency** (add/remove or replacement), the sensitivity under that adjacency, the noise, the **trust model**, the outputs covered by the guarantee and the outputs the lab shows that are **outside** it. Every experiment with a DP mechanism renders this in a "Modelo de privacidad" card and exports it in reports.

### Adjacency and sensitivity

| Quantity | Add/remove (unbounded) | Replacement (bounded, n or K public) |
|---|---|---|
| Count | Δ₁ = 1 | Δ₁ = 1 |
| Bounded sum on `[L, U]` | Δ₁ = max(\|L\|, \|U\|) | Δ₁ = U − L |
| Bounded mean on `[L, U]` | not useful with unknown n: release noisy sum and noisy count separately | Δ₁ = (U − L)/n |
| Proportion count/n | not valid (n not public) | Δ₁ = 1/n |
| Sum of vectors clipped to ‖·‖₂ ≤ C | **Δ₂ = C** | **Δ₂ = 2C** (v → v′ with ‖v‖, ‖v′‖ ≤ C) |

The clipped-sum sensitivities hold only when every protected unit contributes one vector to the sum and the sum is divided by a **public constant** (never by a data-dependent count). Values are clamped to public bounds chosen independently of the data.

**Laplace mechanism.** `M(D) = f(D) + Lap(Δ₁/ε)` is pure ε-DP: `P[M(D) ∈ S] ≤ e^ε · P[M(D′) ∈ S]`. E|noise| = b and sd = √2·b. The guarantee is distributional, not a promise about each draw.

**Sequential composition.** ε₁,…,ε_k-DP mechanisms on the same data cost at most Σεᵢ. The DP4 ledger uses replacement adjacency with a public N (counts Δ₁ = 1, mean Δ₁ = (U − L)/N). Changing the seed never refunds budget.

### Gaussian / RDP accountant ([`src/lib/dp/accountant.ts`](src/lib/dp/accountant.ts))

Noise is `N(0, σ²C²·I)` and the sensitivity of each composition is `k·C` (k = 1 add/remove, k = 2 replacement), so the effective noise multiplier is **z = σ/k**. Per composition `ε_RDP(α) = α/(2z²)`; T adaptive compositions give `Tα/(2z²)`; conversion (Mironov 2017):

```
ε(δ) = min_{α>1}  T·α / (2z²)  +  ln(1/δ) / (α − 1)
```

This is a **valid but conservative** bound: no subsampling amplification. The test suite checks soundness against the exact privacy curve of the Gaussian composition (μ-GDP with μ = √T/z, Dong–Roth–Su 2019): `δ_exact(ε_RDP) ≤ δ` for σ ∈ {0.7, 1, 2, 4}, T ∈ {1, 10, 100}, k ∈ {1, 2}, δ ∈ {10⁻³, 10⁻⁵}, and that RDP is within 2.5× of the exact ε.

### DP-SGD — record-level ([`src/lib/dp/dpsgd.ts`](src/lib/dp/dpsgd.ts))

Per step: (1) per-example gradients `(σ(θᵀx̃) − y)·x̃`; (2) clip to L2 norm C; (3) sum; (4) add `N(0, σ²C²·I)`; (5) divide by the public constant B and update. Batches come from a data-independent per-epoch shuffle (`createBatchScheduler`): ⌊n/B⌋ batches per epoch, so each record appears **at most once per epoch**.

| Adjacency | Batching | Accounting |
|---|---|---|
| any | σ = 0 | **No calculado** (clipping alone is not DP) |
| add/remove | full batch (B = n) | T compositions, Δ₂ = C |
| add/remove | mini-batches | **No calculado**: the schedule depends on n, which differs between neighbours; a tight bound needs Poisson subsampling + amplification (not implemented) |
| replacement | full batch | T compositions, Δ₂ = 2C |
| replacement | mini-batches | ⌈T/⌊n/B⌋⌉ compositions, Δ₂ = 2C |

The last row holds because, with n public, the schedule does not depend on the data. In a step without the replaced record the two output distributions coincide (zero divergence). Rényi divergence is jointly quasi-convex (van Erven & Harremoës 2014), so the worst schedule bounds the mixture over shuffles. Training loss and accuracy curves are computed **without noise on private data** and are outside the guarantee (instrumentation). The test set is treated as non-protected.

### FedAvg variants ([`src/lib/fl/fedavg.ts`](src/lib/fl/fedavg.ts))

`m̄ = max(1, round(p·K))` clients are selected per round by a seeded, data-independent rule; each runs E local epochs of SGD from the global model.

| Variant | Update rule | DP? |
|---|---|---|
| Weighted FedAvg (default) | `w ← Σ (n_k/N)·w_k`, N = samples of participants | no |
| Uniform FedAvg | `w ← w + (1/m̄)·Σ Δ_k` | no |
| Clipped FedAvg | `w ← w + (1/m̄)·Σ clip(Δ_k, C)` | **no** — clipping without noise is not DP |
| DP-FedAvg (client-level, central DP) | `w ← w + (Σ clip(Δ_k, C) + N(0, σ²C²·I)) / m̄` | yes, under the assumptions below |

DP-FedAvg uses uniform weights because n_k-weights would change the sensitivity and n_k is itself private. The denominator m̄ is a public constant. The noise has its own seed (`noiseSeed`), so noise repetitions keep data, client selection and local training identical.

| Client-level adjacency | Participation | Accounting |
|---|---|---|
| add/remove | 100 % | T = rounds, Δ₂ = C |
| add/remove | partial | **No calculado** (fixed-size selection depends on K; amplification not implemented) |
| replacement (K public) | any | T = rounds (worst case: selected every round), Δ₂ = 2C |

**Trust model.** The aggregation server is trusted: it receives every Δ_k in the clear, clips and adds noise. Server-side DP protects the **published global models** against external observers (other clients, analysts, model users). It does **not** protect against the server. Reducing that trust requires secure aggregation and/or distributed or local noise (only discussed conceptually).

### Controlled combined experiment ([`src/lib/tasks.ts`](src/lib/tasks.ts) `combinedCompare`)

A (centralised reference), B1 weighted FedAvg, B2 uniform FedAvg, C uniform + clipping, D DP-FedAvg with R noise seeds. Same data, test set, client selection and local training. The **sequential decomposition** `weighting = B2 − B1`, `clipping = C − B2`, `noise = mean(D) − C` (± sd over R) is an empirical observation under this setup. With interacting effects, another order could split the difference differently.

### Synthetic data ([`src/lib/fl/data.ts`](src/lib/fl/data.ts), [`src/lib/ml/logistic.ts`](src/lib/ml/logistic.ts))

- `generateBlobs`: two Gaussian classes in 2-D sharing an **anisotropic, correlated covariance** (axis SDs 1.6·sd and 0.55·sd, rotated ≈26°), class means `m ± (1, 1)` around `m = (0.8, −0.6)`. The mean-difference direction is not the Bayes boundary `Σ⁻¹(μ₁ − μ₀)` and the bias must be learned, so training needs several iterations (Bayes-level accuracy ≈ 0.86).
- IID: every client has p(y=1) = 0.5 and no shift. Non-IID: label skew `p_k = 0.5 + 0.45·imbalance·t_k`, `t_k ∈ [−1, 1]`; covariate shift of magnitude `featureShift` in a client-specific direction; optional geometric size skew.
- **Scenario evaluation set** (`globalTest`): a balanced mixture of that scenario's client distributions, so it differs between IID and Non-IID.
- **Common reference evaluation set** (`referenceTest`): target population "general regional population" with P(y=1) = 0.5 and no shift, generated with its own seed `REFERENCE_SEED`. It is identical across modes, data seeds, repetitions and client counts, and disjoint from training data. It coincides with the IID training distribution, a deliberate choice that may favour IID.

**Communication model** ([`src/lib/fl/communication.ts`](src/lib/fl/communication.ts)). Per round: `m × P × 4 bytes` down plus the same up (float32 parameters only), with P = 3. It excludes headers, encryption, compression, retries, latency and bandwidth asymmetry.

**Centralised baseline.** Pooled SGD for `rounds × local epochs` epochs with the same learning rate, batch size, data and test sets.

### Educational reproducibility vs production privacy ([`src/lib/rng/rng.ts`](src/lib/rng/rng.ts))

- **Educational reproducibility:** `createSeededRng` (Mulberry32) is deterministic and predictable from the displayed seed. It exists only to repeat classroom experiments and is **never** suitable for production DP.
- **Production privacy:** this needs secure randomness, validated samplers resistant to floating-point attacks (snapping, or discrete Laplace/Gaussian), formally justified assumptions and an audited library (OpenDP, Google DP, Opacus/TF Privacy accountants). `createCryptoRng` only swaps the bit source for `crypto.getRandomValues`. The Laplace and Box–Muller samplers stay floating-point and vulnerable (Mironov 2012), so it is **not** production-ready, and swapping the RNG alone does not make the mechanisms safe.

---

## Limitations (what this lab does **not** demonstrate)

The in-app page `/limits` has the full list. In summary:

- **Seeded PRNG and floating-point samplers** are for reproducibility only; see above.
- **Conservative ε, no subsampling amplification.** Formal ε appears only in the configurations listed in the accounting tables; everything else shows "No calculado" with the reason.
- **Instrumentation outside the guarantee.** Training metrics, per-client accuracy, individual updates and clipped fractions are shown for teaching and are not covered by any ε.
- **Trusted server.** Central DP-FedAvg does not protect against the aggregation server.
- **Unaccounted tuning.** Choosing hyper-parameters or clamping bounds by looking at private results consumes privacy that is not accounted for.
- **Simulated FL.** In-browser clients: no network, dropouts, stragglers, malicious or Byzantine clients.
- **Toy model.** 3-parameter logistic regression; deep, non-convex models behave differently.
- **Leakage illustration is not an attack.** Analytic gradient inversion on a linear model, not DLG-style reconstruction.
- **Secure aggregation is conceptual.** No cryptographic protocol is implemented.
- **Empirical comparisons.** IID vs Non-IID results and the weighting/clipping/noise decomposition depend on the synthetic generator, seed and evaluation distribution. Non-IID is not always worse.
- **Agentic AI section is conceptual.** A deterministic, rule-based simulation; no LLM, no real agent framework.
- **Out of scope.** Membership inference on the final model, poisoning, regulatory compliance (GDPR, HIPAA).

---

## Testing

```bash
npm run typecheck && npm test && npm run build
```

Vitest suites in `src/test/` and `src/modules/quiz/` cover:
- **RNG:** reproducibility, uniform/normal moments, Laplace mean/variance/E|X|/quantiles, invalid scales.
- **DP:** `b = Δ/ε`, input validation, empirical MAE → b, privacy-loss bound ≤ ε, sensitivities (randomised bounded-mean check), sequential composition and over-budget refusal, repeated-release averaging.
- **Adjacency and sensitivity** (`privacy.test.ts`): C vs 2C for clipped sums, including attainability of 2C; counts, proportions, and the add/remove mean error.
- **RDP accounting:** closed-form reference values, k = 2 ≡ σ/2, monotonicity in k, T and σ, and **soundness against the exact μ-GDP curve** over a grid of σ, T, k and δ.
- **DP-SGD:** the five-case accounting table, the real batch schedule respecting ⌈T/⌊n/B⌋⌉, training using exactly that schedule, and noise sd = σC under both adjacencies.
- **DP-FedAvg:** the exact update rule with public denominator m̄, noise sd = σC, m̄ under partial participation, the client-level accounting table, the server-trust assumption, and rejection of weighted DP aggregation.
- **Aggregation:** weighted vs uniform rules, clipping-only (no noise, no ε), DP with σ = 0 equal to clipping-only, noise seed isolating noise from selection and training, reproducible combined comparison, and a decomposition that sums to the total.
- **Reference evaluation:** identical across modes, seeds and client counts; disjoint from training; independent seed and size.
- **Exports:** reports include unit, adjacency, sensitivity, C, σ, (ε, δ) and accountant assumptions; the reason when ε is not computed; a "no guarantee" statement otherwise; general limitations always present; δ never rounded to 0.
- **FL, tasks, quiz:** FedAvg aggregation, selection, non-IID generation, communication totals, sweeps, quiz integrity and challenge reference answers.

## Data storage and export

- Parameters, results, reflections and quiz progress are stored under `pml:*` keys in `localStorage` only. Clearing site data resets the lab.
- Each run is logged in the experiment timeline. Star a run to keep it in **Historial** (`/history`), where runs can be renamed, annotated, compared, and exported as **JSON** (parameters + results) or as a concise **Markdown educational report**. The report includes experiment name, parameters, seed, results, mathematical assumptions, any established privacy guarantee, limitations and student observations.
- All exports are created in the browser with `Blob` downloads. Nothing is uploaded.

## Accessibility

- **Semantics and keyboard:** semantic landmarks, a skip link, `aria-current` navigation and keyboard-operable controls (Radix primitives, native radio groups in quizzes).
- **Charts:** each chart has a text description and a **"Ver datos"** toggle that reveals the underlying data table.
- **Feedback and tooltips:** quiz and challenge feedback is announced through `aria-live`. Glossary tooltips are reachable by keyboard.
- **Theming and motion:** light theme by default with an optional dark mode, honours `prefers-reduced-motion`, and the layout works at desktop and tablet widths.
