# Benchmark: Cybersecurity Analyst (unseen job)

A benchmark assessment for a job with no reference package: a mid-level Cybersecurity Analyst at **Thamar Cloud**, a fictional
Saudi technology startup (company type `startup`, sector `digital`, level `mid`). Everything in it — the company, people, systems,
addresses and logs — is invented. The addresses are documentation ranges (RFC 5737) and private networks.

**This folder holds only what a candidate would receive.** The assessor guide, the reference solution, the rubric's level
descriptors, the objective answers and the script that generated the data are kept out of this public repository, in the
git-ignored `.local/assessment-benchmarks/cybersecurity-analyst/` on the owner's machine (see
`docs/handoffs/MIDAN_ASSESSMENT_INTELLIGENCE_HANDOFF.md`). Because this benchmark is now public, don't use this dataset as a live
assessment.

| File | What it is |
| --- | --- |
| `assessment.json` | Exactly what MIDAN stores in candidate-readable places: the version's scenario, instructions, effort and window, the structured brief and materials (`candidate_package`), and each task's title, instructions and config. No rubric, no guide, no answers |
| `auth_events.csv` | Sign-in log, 314 rows, 8 columns (described in `assessment.json`) |
| `edr_alerts.csv` | Endpoint alerts, 8 rows, 7 columns |
| `asset_inventory.csv` | Asset inventory, 5 rows, 6 columns |
| `incident_response_policy.md` | The company's (fictional) incident response policy, in English and Arabic |

How it was made and how it scored: `docs/assessment/GENERATION_QUALITY_BENCHMARK.md`.
