# SS-011 submission connectivity correction — 2026-09-21

Observed at 2026-09-21T07:51:57.667316Z. This is a successor diagnostic record, not SS-011 acceptance or a replacement for historical readiness evidence.

## Reproduced causes

- The deployed member container shared the Nginx network namespace. Its PostgreSQL connection targeted loopback, while PostgreSQL listened on the host loopback. A connection probe in the actual member container failed with `ECONNREFUSED`; the host-network management container passed.
- The public command-result location accepted a 32-character identifier, whereas client command IDs are 36-character UUIDs. Result queries did not reach the application.

## Applied configuration repair

Backed up the dedicated database, original container description, and Nginx configuration. Retained the original container stopped. Recreated the member container on the host network with the same read-only application and private configuration mounts and existing process limits. PostgreSQL remains loopback-only. A systemd socket proxy bridges Nginx to the host-loopback application through a Unix socket restricted to Nginx UID 101, mode 0600. Updated only the existing member upstreams and command UUID route; no broad public API route was added.

The first attempt was rolled back after a transient 502 immediately after Nginx reload. The second attempt verified the private socket before reload and allowed bounded reload propagation; it passed. No source changes were made by this repair. Existing frontend modifications and their outstanding validation are not certified by this record.

## Verification

- Before repair: real deployed member database probe and isolated HTTP diagnostic failed with `ECONNREFUSED`.
- After repair: both member and management database probes passed.
- Real HTTP handlers and deployed database, synthetic OAuth fixture, transaction rollback: submission 202; identical replay 200 with the same receipt; command query 200; submitted reference present in My Reports; another member's receipt lookup 404. No real member or provider authentication was simulated as live acceptance. All diagnostic transactional rows were rolled back; PostgreSQL sequence allocation is not rollback-guaranteed.
- Public unauthenticated bootstrap and valid UUID command query: 401; public `/api/tickets`: 404; member home: OAuth redirect 302.
- After rollback: command receipts 0, Web submissions 0, service intakes 0, Tickets 0. This proves absence at the observed checkpoint, not the timing of earlier phone clicks.

## Evidence and rollback

Protected local evidence root: `%LOCALAPPDATA%/Codex/ss011-preparation/20260921-a58577d/`. References: `submission-connectivity-before.private.json`, `http-submit-before.private.json`, `submission-network-repair-retry.private.json`, `http-submit-after.private.json`, `submission-connectivity-final.private.json`, `submission-routes-final.private.json`. Raw data remains private and is not duplicated here.

Protected host change archive: `submit-network-repair-20260921T075109Z` under the existing SS-011 preparation directory. The archive contains the database backup and previous configuration. Original container retained as `ss011-member-before-network-20260921t075109z`. Rollback requires restoring the previous proxy configuration and original container/network arrangement and stopping the owned socket bridge; that arrangement retains the reproduced submission defect. Database rollback/deletion is not part of this repair.

## Pending

Real A/B phone submission after fresh OAuth: NOT_RUN at this checkpoint. Existing pending client records must not be interpreted as accepted reports. The empty database checkpoint permits recovery from the earlier failed attempts, but does not justify clearing arbitrary future ambiguous results. Existing general-purpose client discard behavior requires separate correction/verification.

This diagnostic does not prove bounded runner composition, quotas, strict candidate readiness, zero outbound reconciliation, full UI regression, or AC-095–102 completion. SS-011 and parent Gates remain unclosed. No Git publication performed.
