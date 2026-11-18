# Card 35A CPU matrix

Each row is one complete nine-case compiled test-file run. The two independent series ran concurrently; each series ran five files serially. All use the same source and build artifact. Every file acknowledged the configured CDP rate for all six browser instances.

| Run | Normal 1x | Throttled 4x |
| --- | --- | --- |
| 1 | [PASS 9/9](normal-1.tap), [metrics](normal-1-metrics.json) | [PASS 9/9](cpu4-1.tap), [metrics](cpu4-1-metrics.json) |
| 2 | [PASS 9/9](normal-2.tap), [metrics](normal-2-metrics.json) | [PASS 9/9](cpu4-2.tap), [metrics](cpu4-2-metrics.json) |
| 3 | [PASS 9/9](normal-3.tap), [metrics](normal-3-metrics.json) | [PASS 9/9](cpu4-3.tap), [metrics](cpu4-3-metrics.json) |
| 4 | [PASS 9/9](normal-4.tap), [metrics](normal-4-metrics.json) | [PASS 9/9](cpu4-4.tap), [metrics](cpu4-4-metrics.json) |
| 5 | [PASS 9/9](normal-5.tap), [metrics](normal-5-metrics.json) | [PASS 9/9](cpu4-5.tap), [metrics](cpu4-5-metrics.json) |

[Matrix identity and counts](matrix.json), [aggregate measured ranges](aggregate-metrics.json)
