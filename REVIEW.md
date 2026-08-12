# Review guidance

- For error handling, check both nested-route and root-layout coverage, and distinguish render-time throws from rejected promises in fire-and-forget effects. (PR #59)
- Do not turn an explicitly scoped lifecycle fix into a demand for unrelated continuous/background behavior; assess whether the targeted trigger covers the reported failure window. (PR #56)
- Comments should add project-specific reasoning rather than restate upstream documentation; a configuration entry may intentionally be inert until the referenced files exist. (PR #60)
- Audit CLI options for real callers and documented contracts; invalid user input should not silently become a default, and dead options/labels should be removed rather than preserved. (PR #64)
- Put one deadline around a bounded multi-phase async operation, including connection and completion, and clean up timers and resources on every exit path. (PR #64)
- Verify the producer's actual output contract before adding normalization for an assumed format; avoid no-op transformations. (PR #64)
- Treat eventually consistent authentication as a polling problem when appropriate; do not short-circuit on a transient negative probe merely to save a request. (PR #64)
- For read-then-write uniqueness actions, review rapid duplicate invocations and concurrent callers separately; guard in-flight UI actions, make the backend recoverable, and clean up all affected records. (PR #67)
- Review responsive layouts across the relevant viewport and UI-state matrix, including signed-in and signed-out shells; a narrow-screen check cannot validate breakpoint behavior. (PR #67)
- Every result branch in a variant/lookup flow should preserve the alternatives and version metadata needed by its consumers, not only the successful branch. (PR #66)
