# Review guidance

- Trace the actual error-propagation path before asserting that an error boundary, retry, or fallback catches a failure. Distinguish render-time throws from rejected promises in fire-and-forget effects, and check both nested-route and root-layout coverage. (PR #60)
- When code now assumes an invariant, consider data created before the fix. For duplicate or legacy records, choose a deterministic, user-appropriate winner rather than relying on the post-fix invariant. (PR #61)
- Remove redundant reads and dead compatibility inputs only after proving the fallback path is covered; pass already-fetched data through sibling helpers when that is the intended consolidation. (PR #61)
- Keep comments focused on local rationale, not a restatement of upstream documentation; if a configuration entry may be intentionally inert until a file is created, verify that lifecycle before calling it dead. (PR #57)
- Do not turn an explicitly scoped lifecycle fix into a demand for unrelated continuous/background behavior. Evaluate whether the targeted trigger covers the reported failure window and treat consciously out-of-scope edge cases as design decisions. (PR #59)
