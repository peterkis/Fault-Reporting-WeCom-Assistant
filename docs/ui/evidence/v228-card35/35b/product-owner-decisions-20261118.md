# Product-owner decisions — 2026-11-18

The product owner approved the 18 current `darwin-chrome` PNGs as the first baseline. The reviewer will execute human-only `visual:approve -- --all`; the agent must not execute approve. The formal baseline directory remains unpopulated in this worktree.

The approved set is identified by [all 18 SHA-256 hashes](approved-screenshots-20261118.json), captured with input fingerprint `39f4e20b7502d517524e239bbc60a6ea547fe2014a135d87901bef9e56c40ff3`. Its capture receipt is preserved, not rewritten to the later tool input.

The new default is **any pixelmatch-classified changed pixel**: pixelmatch color threshold 0.1, changed when diff pixel count > 0, equivalently ratio > 0. The card's original ratio > 0.1% (0.001) is superseded by this decision. Per-screen overrides remain possible only with a nonempty reason; none is added.

Source-level radius and label experiments must both flag screens with nonzero compare exit codes. They write to independent temporary current directories. After each experiment source files are restored exactly and rebuilt. The approved current PNGs and meta.json must remain unchanged. If a SHA-256 differs, stop and report rather than replacing or recapturing it.

Only the requested affected checks are repeated; the earlier [five-run zero-mask stability table](stability.md) remains bound to its original capture input. No commit, push or approve is authorized for the agent.
