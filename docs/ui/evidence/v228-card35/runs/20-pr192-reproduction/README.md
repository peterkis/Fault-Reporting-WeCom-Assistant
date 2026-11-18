# PR 192 reproduction

The committed application reproduces both review bugs: filtered-empty hides a pending next page, and an empty handled column has no completed drop target. The first pagination fixture lacked its web receipt schema; the existing follow-enabled profile fixes the fixture and then reproduces the reported pagination defect. The temporary test-only compiled injection was restored before strict/build.

- [Broken links before repair](links-before.json)
- [Initial browser results](browser-before.txt)
- [Pagination defect after fixture correction](pagination-before.txt)
- [Both browser regressions after the fix](browser-after.txt)
- [Byte-preserving log rename mapping](log-renames.json)

The initial H5 flow/media failures came from Homebrew executable symlinks. The existing port intentionally rejects symlinks; re-running only those entries with the resolved regular executable files passes, on the same source/artifact. The initial CI results and TAP failures remain here.

- [Initial CI outcomes](initial-ci-results.json)
- [Initial H5 flow failure](initial-001-yxx-h5-flow.integration.test.mts.tap)
- [Initial H5 media failure](initial-001-yxx-h5-media.test.mts.tap)
- [SS009 isolated schema observation](ss009-schema-probe.txt)
