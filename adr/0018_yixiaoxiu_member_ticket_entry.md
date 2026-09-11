# ADR-0018: 医小修成员认证与单工单读取

- Status: Accepted
- Date: 2026-09-11
- Scope: P2-G2-YXX-TICKET-ENTRY local implementation and isolated validation only.
- Authority: user's independent v1.0 authorization; no live or Gate approval.

MEMBER_REQUIRED separates member authentication from Ticket ownership. The configured enterprise/application/Bot scope and explicitly proven identity namespace must match the authoritative source Intake reporter and existing public-ref binding on every read. Unknown namespaces fail closed. A forwarded card does not confer permission.

LEGACY_BOUND_GRANT preserves existing isolated compatibility contracts. MEMBER_REQUIRED never falls back to it when OAuth, entry or identity configuration fails. All Reporter endpoints, old cookies, bootstrap and 304 obey the server-selected policy.

New cards point to `/wecom/yixiaoxiu/tickets/{public_ref}`. A public ref only locates. Both click regions use the same canonical URL. Sender still checks its existing delivery/recipient/Grant bindings.

Historical Grant links in member mode provide location only after OAuth and ownership: ISSUED, CONSUMED and EXPIRED may locate if current HMAC/digest and scope validate; REVOKED, rotated signing secrets, invalid signatures or bindings reject. They are not consumed or resurrected. The old mode retains its original one-use/expiry rules.

Reuse a single safe detail/Timeline query core with server-produced trusted scope. Member reads run authorization and queries in one transaction, recheck the OAuth session before sending, and record access events with NULL persistent session/actor. No schema changes and no weakening of Grant or persistent Session constraints.

Each browser login holds independent bounded intents, with opaque one-use OAuth state and fixed callback. Logout invalidates pending and in-flight authentication as well as sessions. No global current Ticket, credentials in browser storage, or business side effects from authentication.

OAUTH_ONLY stays zero DB; MEMBER_TICKET_READONLY mounts only authentication and Reporter reads; FULL_SERVICE_LOOP reuses the same extension under its separate Gate controls. A member Cookie is never a staff identity. Login establishes no Direct Leg or sending qualification.

PR #7 readiness is historical input. While this candidate changes, P2-G2 preparation is IN_PROGRESS under the existing ASSEMBLY_AUTHORIZED governance profile. The profile's next candidate P2-G2 with authorization true refers only to local preparation. Explicit P2-G2-LIVE authorization remains false. Restore READY only after the complete new candidate evidence passes.
