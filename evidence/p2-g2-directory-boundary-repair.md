# P2-G2 directory deadline and identity review

Implemented the bounded directory contract in `p2-g2-directory-boundary-contract.md`. Default deadline 500 ms, one unresolved request per port, AbortSignal cancellation, and DEFERRED fallback preserve service admission even when the injected resolver never settles. INACTIVE directory accounts retain explicit-fault Tickets and create existing Manual Review items. Router policy version is `p2-015-safe-route/1.0.4-g2`.

The real PostgreSQL source tests cover directory resolution, all membership roles, independent reported location text, public HTTP omission of profile payload, actual never-returning directory behavior, inactive account review, unchanged historical snapshot, and a later inactive assertion with restricted review provenance. They do not claim a Person registry, shared current Person profile, hospital master-index binding or live directory access.

Validation:

- Deadline RED: `tmp/p2-g2-tests-2d0863c1-091d-40fa-a7a5-9ab554a0cecf/run.json`, 0/1, exit 1; unresolved call did not return DEFERRED.
- A preliminary direct `node --test` invocation lacked the database environment and failed `P2_G2_LOCAL_DATABASE_REQUIRED`; it is not database RED evidence.
- Actual PostgreSQL INACTIVE RED: `tmp/p2-g2-tests-fdf102f8-3c07-41d2-96c9-0b081c014a97/run.json`, 0/1, exit 1; Inbox/Ticket existed but Review count was zero.
- Intermediate test `75d5763b-25f2-48ef-8cd9-2c8bb585d7db` passed 6/7 because a source-edit command stopped on a Windows encoding error before the inactive-routing edit; corrected using explicit UTF-8.
- Initial joint GREEN: `tmp/p2-g2-tests-d2a8c0bc-085e-4725-b4d8-133abddb85ae/run.json`, 18/18, exit 0.
- Independent reviewer found missing provenance for a later INACTIVE snapshot. Reproduced RED `tmp/p2-g2-tests-1320a28e-a703-4c27-b15c-7326ecac074e/run.json`, 1/2.
- Final joint GREEN: `tmp/p2-g2-tests-c4092b24-0341-4af4-a7d7-96fceab3c88e/run.json`, 19/19, exit 0; TAP SHA256 `abd554de9cdd4a0c6a01c8ee1ece6029c1777faa3505b62183447663eb0b46b3`. Includes P2-015 unit and real database integration regression with fixture database cleanup.

All inputs and directory results were synthetic. No actual directory or model network calls, no Provider sends, no new database schema and no P3 work.
