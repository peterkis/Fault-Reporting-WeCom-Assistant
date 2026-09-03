# ARCH-005 Start Authorization

- authorized_at: 2026-09-03
- phase: P2 / IN_PROGRESS
- active_task: ARCH-005
- active_lane: ARCHITECTURE
- branch: `arch/asia-shanghai-local-time`
- baseline: `358d9f69392141401c4ca3b7ba46294541d2a696`
- authorization: Asia/Shanghai Local Business Time Contract only
- exit_after_automation: `READY_FOR_TARGETED_LIVE_REVALIDATION`

## Frozen start gate

- `HEAD`, `main`, `origin/main`, and `phase-p2-g1-passed-v1.4^{commit}` all resolved to the baseline above.
- `origin/main...HEAD` was `0 0`; the worktree was clean and `git diff --check` passed.
- `staging/p2-007-domain-package-v1.2` resolved to `c37bea8a66d69b38f6d2182702cb5d9f89f1a884` (`before p2-007 exec`).
- The staging commit is not an ancestor of the ARCH-005 branch. The old local name `phase2/ai-orchestrator` does not exist.

## Authorization boundary

P2-007 remains `TODO / BLOCKED_BY_ARCH_005`. The staging package is read-only and is not merged, cherry-picked, copied, or edited by ARCH-005. DeepSeek, OCR, Incident, P2-G2, P3, production/clinical enablement, push, merge, tag, release, and every Feature Flag remain outside this authorization.

## Migration safety preflight

- Existing Pilot PostgreSQL data was found; an empty database was not assumed.
- P1-011 AES-256-GCM backup preflight and isolated restore drill succeeded using a command-scoped ephemeral key.
- backup checkpoint: `backup-6ed152b4-1e8d-469f-bce9-471452ab3490`
- encrypted artifact SHA-256: `796c05cb740c25e0c33b6ae01e84f589c1e41ea7092db17e81cbbce3e047c6d7`
- encrypted artifact size: `370628` bytes
- restore drill: `restore-c2cb785d-aace-49db-9a8a-f957e5231223`, `13` verified objects, `SUCCEEDED`
- No key material was written to the repository, `.env`, console output, or Evidence.

## Stop line

Automated success does not complete ARCH-005. It may only advance the task to `READY_FOR_TARGETED_LIVE_REVALIDATION`; project-owner live revalidation and a separate closing commit are still required.
