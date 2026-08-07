---
name: issue
description: Create or improve a FitCrew GitHub issue when the user asks for a feature, bug report, product idea, or issue-quality rewrite. Use this before running gh issue create or gh issue edit so the result is a decision-ready specification grounded in the repository.
---

# GitHub Issues — FitCrew

An issue is a small product and engineering brief, not a sentence describing a future task. It should let someone implement the work without rediscovering the product problem, the existing design decisions, or the dangerous edge cases.

## Workflow

1. **Research first.** Inspect at least three related issues, including any issue numbers the user names. Read the relevant code, schema, routes, and existing self-checks. Search for prior art before proposing a new table, component, dependency, or interaction. Completion means you can state what exists today, what is missing, which issues it depends on, and which constraints are already deliberate.
2. **Choose the issue type and title.** Use a short imperative title with the repository convention: `feat: ...` for a product capability, `fix: ...` for a broken behaviour, and `chore: ...` for maintenance or infrastructure. Add the matching GitHub label when it exists.
3. **Describe the product problem.** Start with the user's situation and the current behaviour. Explain why the gap matters and what becomes possible when it is fixed. Name dependencies and deliberate non-goals instead of hiding them in implementation notes.
4. **Make the proposal concrete.** State the intended semantics and the important trade-offs. A proposal can leave a genuine product decision open, but it must name the decision and its consequences in `À trancher avant d'implémenter` rather than saying only "TBD".
5. **Write the risk boundary.** Call out the traps that can make a plausible implementation wrong: authorization and privacy, data ownership, legacy rows, migrations and old clients, concurrency, limits and cost, time zones, failure and fallback states, and interactions with existing product rules. Include only risks relevant to this issue, but do not omit a known hard one.
6. **Make acceptance observable.** Use checkboxes. Each criterion must describe something a user, a query, or an automated test can verify. Include the important negative cases and automated coverage when the change has logic, persistence, parsing, permissions, or external I/O.
7. **Close the scope.** Add `Out of scope` with explicit follow-ups and tempting adjacent work that this issue does not include.
8. **Self-review before publishing.** Check that the issue has a concrete context, a proposed direction, repository prior art or an explicit statement that none exists, named traps, testable acceptance criteria, and an out-of-scope boundary. Remove generic bullets, solutionless wishes, and claims not supported by the repository.

## Recommended Shape

Use these sections for a feature or product issue. Keep the established mixed French/English headings used by FitCrew when that makes the issue easier to scan.

```md
## Contexte

Who is affected, what happens today, why it matters, and which issue or product decision this follows.

## Proposed solution

The smallest coherent product behaviour, including the key trade-off.

## Prior art dans le repo

Relevant files, functions, tables, indexes, components, and existing conventions to reuse.

## Traps worth naming up front

The product, data, security, performance, compatibility, and failure cases that need an explicit answer.

## Acceptance criteria

- [ ] Observable user behaviour works.
- [ ] Important negative case is handled.
- [ ] Automated coverage protects the risky logic.

## Out of scope

Adjacent work deliberately left for another issue.
```

Use `À trancher avant d'implémenter` between the proposal and the traps when the product decision is real and blocking. Do not force a `Prior art` section to invent relevance: state that no reusable primitive was found and explain why a new one is justified.

## FitCrew-Specific Checks

- Read the data model before proposing persistence. Identify ownership, indexes, bounded reads, versioning, and legacy optional fields.
- Treat Convex functions and their existing clients as an API. Do not suggest deleting or tightening a function without an expand/contract rollout.
- Separate a user's current state from historical, archived, or completed state. Say which one the feature reads or mutates.
- For Coach or Chef work, state what enters the system prompt, what is fetched on demand, what the model may mutate, and how the tool behaves when context is absent or ambiguous.
- Preserve user isolation. A lookup must derive the authenticated user server-side; an identifier supplied by the model or client is not authorization.
- Bound any list, search, prompt payload, external call, or migration batch. Explain the fallback when the bound is reached.
- Name tests for lineage and legacy data, auth boundaries, empty and ambiguous results, and failure states when they apply.

## Publishing

For a new issue:

```sh
gh issue create --repo govroumvroum/fitcrew --title "feat: ..." --body-file <file>
```

For a rewrite, preserve the issue number and use `gh issue edit <number>`. After either operation, verify the title, body, labels, and open state with `gh issue view <number>`. Do not claim an issue is complete until the published body contains every required section and the local workflow files pass `git diff --check`.
