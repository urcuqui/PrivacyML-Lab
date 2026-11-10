# Privacy-Preserving Machine Learning — Hands-On notebook

`Privacy_Preserving_Machine_Learning_Hands_On.ipynb` is a self-contained Jupyter notebook (explanations in Spanish, code identifiers in English) for a 90–120-minute postgraduate session on Differential Privacy, Federated Learning and Secure Aggregation. It does **not** require the PrivacyML-Lab web app.

## Run it

```bash
cd notebooks
python3 -m venv .venv && source .venv/bin/activate   # Python 3.11+
pip install -r requirements.txt
jupyter lab Privacy_Preserving_Machine_Learning_Hands_On.ipynb
```

Then use **Run → Restart Kernel and Run All Cells**. It runs on CPU in a few seconds and needs no GPU, external datasets, API keys or network access (only to install the dependencies). The notebook is saved **with outputs**, so students can read example results before running it.

## Contents

| Section | Topic | Main experiment |
|---|---|---|
| 0 | Introduction and setup | Concepts and environment; seeded randomness = educational reproducibility only |
| 1 | Why privacy? | Differencing attack on neighbouring datasets; add/remove vs replacement; global vs observed sensitivity |
| 2 | DP fundamentals | Laplace mechanism from its definition; ε comparison; numerical check of the DP inequality |
| 3 | Privacy vs utility | MAE vs ε (empirical vs Δf/ε); noise distributions; bounded mean and clamping bias |
| 4 | Privacy budget | Sequential-composition ledger (budget 2.0); averaging repeated releases |
| 5 | Federated Learning | NumPy logistic regression (checked against scikit-learn); FedAvg `Σ n_k/N · w_k` step by step vs centralised |
| 6 | Non-IID | IID vs Non-IID on one common reference set; client drift; per-hospital accuracy |
| 7 | Why FL is not enough | Exact gradient inversion for one example; what a batch gradient still reveals |
| 8 | Securing FL | Client-level clipping + Gaussian noise (ε **not** computed); additive secret sharing and pairwise masking in Z_Q |
| 9 | Agentic AI | Conceptual: model-level privacy does not imply system-level privacy (FATE-LLM context) |
| 10 | Summary | Tables built only from executed results; "¿Qué aprendimos?"; references |

## Notes

- All data is synthetic, and every experiment uses its own seed derived from `SEED`. Changing `SEED` or the parameters changes the numbers. The interpretations name the values obtained with `SEED = 2024`.
- No formal ε is reported for the federated DP mechanism: there is no privacy accountant in the notebook. The PrivacyML-Lab web app implements a conservative RDP accountant with explicit adjacency assumptions.
- The secure-aggregation code only illustrates the idea. It has no dropout handling, authentication or collusion resistance.
- This notebook replaces the historical PySyft-based material in [urcuqui/Data-Science › Secure Learning/private-ai](https://github.com/urcuqui/Data-Science/tree/master/Secure%20Learning/private-ai) with plain NumPy code. It uses that material only as an educational reference and does not modify it.
