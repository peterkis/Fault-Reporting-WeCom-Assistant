# SS-011 AC-099 independent formal runner recovery drill — 2026-09-22

This is a technical recovery drill on an independent restored database. It does not close the live SS-011 AC-099 item or authorize parent Gate progress.

## Scope and isolation

- Source snapshot: protected backup `/var/backups/fault-reporting-wecom/ss011-recovery-20260922T003429Z/current-db.dump`, SHA-256 `bef948f57f0bf6837d768a2a44578956c00e0e75f184749144ef57dd26f4402a`;
- Independent database: `p2_015_ss010_55a991bd`;
- Current business database `p2_015_ss010_44196b2e834c` was not stopped or modified;
- Independent runner used App pool 4, Worker pool 2, Controller pool 1, no Gateway, no sender and no external provider;
- Independent drill directory and database are retained for review.

## Drill sequence

1. Created an empty schema and approved staff reference rows in the independent database.
2. Started the formal `yxx-limited-write-runner` with `resume=false`, then stopped it through its runner stop path. State became `STOPPED`, counts `0/0/0`, and `cleanup_passed=true`.
3. Restored the current SS-011 snapshot data into that same independent database without changing the original database.
4. Resumed the formal runner with the same manifest and state. The runner reconciled counts to 6 Intake, 3 supplements and 2 Tickets.
5. Used synthetic member sessions against the resumed HTTP App. A replay of an existing command was sent with a deliberately destroyed HTTP response, then repeated with the same command ID. The second request returned HTTP 200 with `replayed=true` and the original result. The command lookup returned 200 for the owner and 404 for the other synthetic member.
6. Stopped the resumed runner through its stop path. Final state was `STOPPED`, counts `intakes=6`, `supplements=3`, `tickets=2`, and `cleanup_passed=true`.

The successful phase output was: `lost_http_status=200`, `lost_response=true`, `replay_status=200`, `replay_body_replayed=true`, `command_query_status=200`, `cross_member_command_status=404`. No independent drill data was added by the replay; counts before stop were 9 receipts, 6 Intake and 2 Tickets.

## Limits of this evidence

The drill used synthetic OAuth within an independent database and a technical-drill-only manifest. It proves the formal runner/state stop-resume and response-loss replay mechanism, but it is not a real A/B HTTP capture and does not replace live AC-099 evidence. The live SS-011 service remains standalone and was not converted or restarted. The first two failed preparation directories are retained as failure evidence; the stale one was explicitly marked `STOPPED_WITH_FAILURE`.
