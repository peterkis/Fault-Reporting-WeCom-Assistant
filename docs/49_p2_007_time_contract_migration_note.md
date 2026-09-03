# P2-007 Time Contract Migration Note

The read-only P2-007 v1.2 staging package at `staging/p2-007-domain-package-v1.2` contains multiple project-owned `format: date-time` definitions that conflict with ARCH-005. ARCH-005 does not import, edit, merge, cherry-pick, or implement that package.

A later separately authorized P2-007 branch must apply all of the following before implementation:

- upgrade the package contract version to v1.2.1 or higher;
- change `reported_at`, `occurred_at`, `observed_at`, `fetched_at`, `issued_at`, `expires_at`, and equivalent business fields to strict Asia/Shanghai LocalDateTime (`YYYY-MM-DD HH:mm:ss`);
- add authoritative PhysicalEpochMs strings for continuation/deadline expiry, including `expires_epoch_ms`;
- remove project-owned JSON Schema/OpenAPI `format: date-time`;
- update all fixtures and TypeScript declarations; JavaScript Date must not enter domain/hash/command/result values;
- recompute package-level manifests and hashes only after the contract/fixtures are final;
- keep every Feature Flag false until its separately authorized Gate.

The formal P2-007 flow starts from the post-ARCH-005 `main`, creates a new `phase2/ai-orchestrator`, forms a separate authorization commit, and may then apply the staging tree with `git cherry-pick --no-commit staging/p2-007-domain-package-v1.2`. The staging commit itself must not be preserved in formal P2-007 history.
