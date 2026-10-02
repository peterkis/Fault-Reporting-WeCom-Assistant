# T04-05 independent review: ARCH006 content binding and npm launchers

The supplied independent review is pinned to published PR #37 head `1911d364e48530683032f8856c41678c80f69dc9`, base `87de2bc9e8835882cd390b024a04e2865cd367f9`. This repair addresses its two P2 findings only. The earlier raw-input variance repair remains closed; no production source, SQL, package dependency, feature flag or protected historical Evidence is changed.

## ARCH006

The real existing classifier accepted a committed `throw new Error('SYNTHETIC_RUNTIME_REGRESSION')` in Foundation while the ten changed paths stayed identical. Both original and mutated CLI exits were zero. The regression failed with the expected assertion that the same-path mutation must be rejected. These Git commits belong to an owned synthetic clone, not published PR history.

The workflow now supplies `EXPECTED_BASE` from the PR event. The classifier requires the reviewed base and binds the complete raw Git delta to independently reviewed runtime content. The fingerprint covers paths, full old/new blob IDs, old/new file modes and change types, with renames disabled:

```text
git diff --raw --full-index --no-abbrev --no-renames -z <event-base> HEAD -- src scripts database/migrations web archive .env.pilot evidence
SHA256: 072b0e29d8e4fdf07f27ccbe2c74757a6e2146dfae988642b76c61f249f3a8df
```

The expected fingerprint is fixed from the reviewed `1911d36` object, never recomputed from a candidate to authorize that candidate. A different base requires a separate review. Dirty tracked or untracked files in those runtime roots cannot borrow HEAD's fingerprint. The old six path-only alternatives are removed from the current classifier; historical checkouts retain their own original tools.

Real CLI regressions retain acceptance for a documentation-only successor and both original two/three-error rejection texts, independently of `origin/main` movement. They reject same-path committed/dirty content, executable mode changes, extra SQL/Evidence changes, wrong/missing event base, extra diagnostics and a readiness PASS. The original ARCH006 validator and strict readiness CLI remain unchanged and rejected. `ARCH006_KNOWN_BASELINE_NOT_READY` is not business readiness.

## npm launchers

A real `.cmd` launcher in a separate directory executed installed npm 11.9.0 successfully. The old Foundation suite failed with `MODULE_NOT_FOUND` before product preflight. The normal installation passed 3/3, isolating the launcher's layout assumption.

The two affected tests now share a typed tooling launcher. It executes the discovered executable rather than inferring an adjacent npm installation or treating a shell wrapper as JavaScript. Unix executable/symlink launchers run directly. Windows native executables run directly; `.cmd`/`.bat` use explicit `cmd /d /v:off /s /c` with Windows argv quoting and cmd metacharacter escaping. Only a discovered JavaScript file is passed to Node. The Foundation test invokes this compiled tool without importing the tooling graph into the product runtime tree.

Regressions use actual npm, a forwarding wrapper outside its installation, a wrapper path with spaces and literal percent characters, literal script arguments, and exit 17 from an actual npm script. Unix CI additionally exercises a real JavaScript symlink. Original preflight privacy, unsupported serve arguments, missing-artifact rejection, batch pass/fail/skip, unknown batches, no-argument gate and report-directory spaces remain covered.

## Validation boundaries

Focused real CLI regressions were RED before GREEN on Node 24.18.0 / TypeScript 5.9.3. The final full Windows tooling run passed 58/58, Foundation CLI passed 3/3, and the default gate passed strict/build/artifact checks and the 1/1 canary. These were local executions of the uncommitted repair on the 1911 parent; this documentation successor does not relabel them as published-head CI. Earlier diagnostic attempts (stale artifacts or wrapper `CALL` argument rescanning) are retained separately, not counted as final green evidence. Exact published-head CI and independent fix review are recorded separately after completion on [PR #37](https://github.com/peterkis/Fault-Reporting-WeCom-Assistant/pull/37).

No new PostgreSQL/browser session, full 213-entry local registry run, live Provider send, production write, merge, deployment or Gate approval is performed by this repair. The configured CI still executes both tooling platforms and all six batch selections. Existing 1911 CI is historical evidence, not a test result for the repair. T04-05 stays IN_PROGRESS and T05-01 remains unauthorized. Removing the classification exception makes the unchanged strict rejection fail closed; it cannot grant READY.

## Independent fix review and host follow-up

The first repair was published as `27f05894642fa1908b5192cb9edb4c73f17226ed`. Its independent Standards axis reported no findings; Spec found that the Unix JS-symlink test still assumed the discovered host npm was JS, and Windows quoting did not preserve a quote combined with pipe/redirection arguments. Both were reproduced through real npm launchers, not simulated platform values. The Windows regression failed with exit 255 instead of the fixture's exit 17. Native Linux Node 24 reproduced the exact old JS-target assertion failure when PATH npm was a valid shell wrapper.

The JS-symlink regression now constructs its own real Node launcher, forwarding to discovered npm without making an installation/target-kind assumption. An additional nested real shell-wrapper host proves that the whole launcher regression works under that environment. Windows argv quoting now doubles embedded CRT quotes while keeping cmd's quote context balanced, escapes command metacharacters separately, and retains literal arguments through a forwarding `.cmd`. Real npm tests cover quote + pipe and quote + redirection combinations, preserving argv and exit 17. The literal-quote rule is documented by [Microsoft](https://learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments?view=msvc-170); the regression's actual process behavior is the acceptance evidence.

CI `36963812110` also exposed a Linux-only mode-fixture error: staging `+x` without changing the actual executable bit left the owned clone dirty, so its subsequent checkout failed. The fixture now performs a real chmod on Unix and asserts the mode mutation is a clean committed object before checking rejection. The failed Ubuntu job's original logs and artifact were downloaded; remaining work was cancelled to avoid wasting runner time. The classifier itself had rejected the mutation.

Follow-up focused results: Windows 4/4 (launcher cases + ARCH006), Foundation CLI 3/3; native Linux 6/6, including the shell-wrapper host and clean executable-mode commit. Linux used checksum-verified official Node 24.18.0 (`55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742` for its x64 archive) and the locked TypeScript 5.9.3 dependencies. A first `/mnt/c` run was not full green because file access exceeded the unchanged deadline; the same candidate passed on an owned native Linux temporary filesystem. No timeout was relaxed. These follow-up runs are an uncommitted patch on the 27f0589 parent, not a fabricated published-head result. The replacement exact-head CI and fresh two-axis review remain separate publication results.

The second publication, `193a9eb49df951a37d9c8e4feb0b1b720811bd47`, passed both CI tooling hosts. Its fresh complete checkout passed history identity, build and artifact verification; the unchanged original strict CLI still exited 1 with `YXX_VERIFICATION_REJECTED`. Independent Spec review closed the two previous findings but reproduced one remaining launcher-fixture assumption: `where.exe npm.cmd` rejected a valid native `npm.exe`-only host even though actual npm and the shared runner both reported npm 11.9.0 successfully. That published-head review and RED probe are retained independently.

The fixture now uses the same actual launcher discovery as the runner. It supports native and JavaScript hosts without requiring a `.cmd` installation. A permanent nested Windows JS launcher host provides Node and Git but no `npm.cmd`; it failed before this repair and passed 4/4 afterward. The reviewer's original real native `npm.exe` probe also passed 4/4. The Windows fixture quotes literal percent characters in its own batch source, and its JS forwarder executes the already discovered launcher to avoid rediscovering itself through the current working directory. Native Linux launcher cases passed 5/5. These local follow-up results are a patch on the 193 parent; only the subsequent exact-head CI establishes published-head completion.
