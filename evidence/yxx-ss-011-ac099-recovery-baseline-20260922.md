# SS-011 AC-099 recovery baseline — 2026-09-22

The new recovery window was confirmed. Before any process change, a fresh protected cloud backup was completed without stopping services or changing business facts.

- Database: `p2_015_ss010_44196b2e834c`;
- Protected backup directory: `/var/backups/fault-reporting-wecom/ss011-recovery-20260922T003429Z`;
- Custom database dump SHA-256: `bef948f57f0bf6837d768a2a44578956c00e0e75f184749144ef57dd26f4402a`;
- Baseline counts: 9 command receipts, 9 submissions, 6 Intake, 2 Tickets;
- Protected configuration references and safe container descriptions were copied and hashed;
- Business facts modified: false.

Read-only runner inspection then showed the active member container still runs the standalone command `scripts/p2-g2-yixiaoxiu-serve.mjs --serve`, with no active runner `state.json`. The source tree contains the formal `yxx-limited-write-runner`, but it is not the current process. The runner rejects a fresh start against the populated database (`empty` guard) and there is no prior state bound to this database/manifest for resume. A direct restart would therefore not qualify as AC-099.

AC-099 remains `NOT_RUN` for the formal same-runner/same-state drill. No state was fabricated, no business rows were reset, and no current service was stopped.
