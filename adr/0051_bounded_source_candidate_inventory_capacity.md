# ADR-0051: Bounded source candidate inventory capacity

Status: Accepted by the user's explicit authorization on 2026-10-28: “授权调整上限并继续修复、复审和合并”.

## Context

PR #123's published candidate `af709901cf63effe37f7f85187807a13f7b11d9c` contains 2068 committed controlled source paths, compared with 2018 at its main base. TypeScript CI run `40695572199` correctly rejected the SS-008 Worker assembly before startup because the source inventory exceeded 2048 files. The root was verified as the canonical source checkout. Its 2712 compiled outputs are a separate representation and do not explain this source admission failure.

[ADR-0045](0045_versioned_current_readiness_scope.md) deliberately retained the 2048-file source limit. The user has now explicitly authorized a finite capacity adjustment after reviewing the source census, the original failure and the proposed boundary/integrity/resource checks. This decision supersedes only that current-source capacity clause; ADR-0045 and historical checkouts/evidence retain their original wording, code and identities.

## Decision

- The current G2 source inventory admits at most **4096 regular files** and rejects the 4097th file before reading its contents. The limit remains fixed in code, with no caller or environment override.
- Candidate roots, controls, exclusions, sorted path/content hashing, UTF-8/LF normalization, binary identity and the V2 fingerprint representation stay the same. No source, test, source map or frontend asset is omitted to fit a limit. Changing the capacity implementation itself changes the full source candidate fingerprint; existing approvals and evidence cannot authorize the new candidate.
- The per-file **16 MiB** bound and symbolic-link rejection remain. The asynchronous implementation still reads at most four files per batch and yields between batches; no long-lived content cache or readiness cache is introduced.
- Compiled runtime identity continues to use the complete physical-output inventory and canonical manifest through the existing artifact verifier. Source count and compiled output count remain separately reported.
- Local dependencies and unrelated user materials are preserved. A local tree containing nested prototype dependencies may still fail source admission. Current candidate validation uses an owned clean checkout containing the actual controlled source, rather than deleting those materials or excluding additional paths.

## Verification and limits

Use the existing registered candidate tests to prove exact 4096 acceptance and 4097 rejection in both synchronous and asynchronous paths. Retain changed-content, oversized-file, invalid-UTF-8, symbolic-link and event-loop-progress checks. Measure fresh source inventory wall time and peak process memory in the clean current checkout, report file count/input bytes, and re-run the actual failed SS-008 assembly and affected artifact/tool checks.

Original CI failures and NOT_RUN entries remain historical facts. Local subsets do not replace the new published head's review and applicable CI, full/certify or a live readiness decision. P2-G2-LIVE, P2-008, P2-G3 and P3 remain stopped; this decision grants no deployment, real sending, business database write or Gate approval.
