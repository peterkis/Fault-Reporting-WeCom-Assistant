# SS-005 pagination diagnostic follow-up

The historical mixed-list assertion returned 498 unique references instead of
500. The failure did not retain missing source kinds or cursor boundaries, so
its cause remains **UNREPRODUCED**, not fixed or dismissed as transient.

The isolated local cluster was verified at repository-owned `tmp/yxx-pg-55432`,
port 55432, listening only on 127.0.0.1. The original test passed once and then
20 consecutive runs returned 500/500. This repetition does not prove a repair.

The test now retains the original time distribution and asserts 250 eligible
Web roots plus 250 eligible Bot tickets before traversal. A failed traversal
reports per-page source counts and missing synthetic references. After the
original traversal, a second traversal uses the same 500 rows at one shared
second to exercise source-rank and UUID ordering boundaries. This deterministic
boundary check passed; the local database uses C/C collation.

No production query change was made. No real OAuth/SDK, production database,
external notification or deployment was used. The remaining historical failure
must remain visible in final readiness limitations until sufficiently diagnosed.
