# Published-history review preflight

## Why PR #19 kept receiving the same ancestry finding

The latest finding was attached to the published review head `20c2f032106e897b3ac802355b5218e363646a3d`, but its body evaluated `3fdfeeedefee5afade93004320765d6ac43ffe60` instead.

Independent GitHub API reads during this repair establish:

- `GET /repos/peterkis/Fault-Reporting-WeCom-Assistant/git/commits/20c2f032106e897b3ac802355b5218e363646a3d` returns the sole parent `dcf688038a76e471b443be33af4aad6278d72bd2`, exactly the r5 report's tested_head.
- Comparing that tested_head with the reviewed published head returns `ahead_by=1`, `behind_by=0`, and merge base `dcf688038a76e471b443be33af4aad6278d72bd2`.
- The repository's Git commit API returns HTTP 404 for `3fdfeeedefee5afade93004320765d6ac43ffe60`. Its provenance is unverified. This does not prove that the object never existed in any other environment; it does mean it cannot be substituted for the published head.

The earlier repeated findings/replies show the same distinction between review metadata and separately named objects. A reparented review snapshot is consistent with the reported symptoms, but this repair does not claim access to, or certainty about, the review provider's internal snapshot construction.

Rebinding a correct tested_head or generating another evidence revision cannot repair an environment that keeps substituting a different commit graph. This repair establishes the commit's identity *before* drawing an ancestry conclusion, while retaining the original evidence gate.

## Two separate checks, not a weaker gate

```text
GitHub PR event / review metadata gives an authoritative full SHA
  -> full, clean checkout of that exact object
  -> verify-published-history.mjs
  -> unchanged validate-yxx-self-service.mjs --require-ready
```

The preflight accepts the exact published PR head, or an explicitly identified GitHub merge preview whose two ordered parents equal the same event's base and head. It never accepts arbitrary same-tree commits.

It rejects shallow clones, replace refs/grafts, dirty worktrees, missing objects, mismatched raw commit identities, wrong tested trees, and real ancestry breaks. It uses Git without replacement objects, sanitizes inherited Git environment overrides, performs no network requests, and does not write to the checkout, index, reports or refs.

The current report is read from the committed `plans/yxx-self-service-ticket-plan.json` entry for `YXX-SS-009`; there is no frozen r5 or head SHA in the executable.

| Result | Meaning |
| --- | --- |
| Exit 0 / `REVIEW_HISTORY_PREFLIGHT_PASS_NOT_READINESS` | Identity and ancestry checks passed. Strict readiness is still `NOT_RUN`. Run the original strict command. |
| Exit 2 / `REVIEW_CHECKOUT_IDENTITY_MISMATCH` | Local checkout is not the authoritative object. Reconstruct the review environment, not the evidence. |
| Exit 2 / incomplete, overlay, dirty or unavailable history | The environment cannot support this history conclusion. Fetch a clean full checkout; otherwise report this verification as unavailable. |
| Exit 1 / `PUBLISHED_EVIDENCE_ANCESTRY_MISMATCH` | The exact identity-verified published object really lacks the tested ancestor. Preserve the history or regenerate evidence; this remains a defect. |

An environment problem does not exempt other independently reproducible code findings from review.

## Running locally

Get the full head SHA from the GitHub PR API or the exact review's metadata, not from `git rev-parse HEAD`. A past review must be checked against its own recorded head, not silently against a newer revision.

In a clean full checkout of that object:

```sh
node --test .github/review/verify-published-history.test.mjs
node .github/review/verify-published-history.mjs --expected-head <FULL_SHA_FROM_GITHUB>
node scripts/validate-yxx-self-service.mjs --require-ready
```

For a GitHub-generated merge preview, supply all three values from the same event/API observation:

```sh
node .github/review/verify-published-history.mjs --expected-head <PR_HEAD_SHA> --expected-merge <MERGE_PREVIEW_SHA> --expected-base <BASE_SHA>
node scripts/validate-yxx-self-service.mjs --require-ready
```

Logs must be written outside the checkout so they do not become untracked candidate files. A shallow or reconstructed sandbox should use a separate fresh clone; do not reset the user's worktree or manufacture a replacement parent chain. Merely fetching an object does not change a wrongly checked-out HEAD.

## Automated reproducibility

`.github/workflows/ss009-published-history.yml` runs on PR #19 with separate `head` and `merge` jobs. Each uses the event's exact SHA and `fetch-depth: 0`, runs the synthetic Git tests, runs the preflight, installs locked dependencies with lifecycle scripts disabled, and runs the unchanged strict CLI. Logs are uploaded from the runner's temporary directory, outside both the candidate inventory and historical evidence.

The workflow is intentionally scoped to this SS-009 delivery PR, not installed as a permanent frozen-SS009 gate for unrelated later work. The review preflight itself remains reusable. The workflow has read-only contents permissions, does not use pull_request_target, does not load environment files or production credentials, and does not deploy, merge, connect to WeCom, access hospital data, or advance any Gate.

These files belong to review infrastructure under `.github`, outside the already established runtime candidate roots. No candidate exclusion was added. Runtime source, product tests, scripts, package files, migrations, original reports, plan status and the original strict validator remain unchanged by this repair.

## Tests and truthful completion boundaries

The repair's 22 synthetic Git tests passed locally with Node v22.16.0 and Git 2.47.3. They exercise actual temporary repositories, including a same-tree single-parent snapshot, a genuine published squash, two-parent previews, a real shallow clone, replacement refs, grafts, dirty trees, invalid reports, CLI argument validation, read-only behavior and inherited Git environment isolation. Temporary repositories are test-owned and removed after each test.

The product's Node 24 runtime requirement is unchanged. CI uses Node 24. A local preflight test result does not claim a new product regression run, browser test, PostgreSQL run, independent product review, live validation or remote approval. The existing r5 `1182/1182` result remains the historical execution recorded by that report, not a result created by this repair. The remote strict result must be read from the actual completed Actions jobs.

Appending review-only commits preserves the tested ancestor; it does not require replacing the recorded tested_head with the latest documentation commit. A genuine squash/rebase that loses the tested ancestor still cannot reuse completion evidence without regenerating it. No automatic PR merge is performed.
