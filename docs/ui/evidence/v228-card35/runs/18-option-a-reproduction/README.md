Option A reproduction and initial failures

The two transport tests fail on the previous candidate: healthy reads incorrectly retain a disconnect timestamp, and CLOSED does not immediately check authorized GET. The final source passes the same checks and the registered 35A scheduler scenarios.

The first typecheck reported TS7022 in the added test; an explicit number annotation fixed it before the final typecheck/build.

The first regression invocation omitted TS_MIGRATION_TEST_DB_ISOLATED=1. The runner refused 26 database entries before execution; five database-free entries passed. The blocked entries were re-run with the required flag, without changing shared databases or test assertions.
