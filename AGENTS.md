# Development Guidelines

## Text generation (all user-facing and AI-generated copy)

Follow [blader/humanizer](https://github.com/blader/humanizer). Generated prose and UI copy must
state the point directly and concretely. The strongest tells to eliminate on sight:

1. "Not X but Y" framing — state the claim.
2. One-line closers and dramatic fragments that restate the previous sentence.
3. Aphorisms that sound deep ("At its core...").
4. Staged run-ups ("Here's the thing", "Let's dive in").
5. Arguing with no one ("I'm not saying X, but...").
6. Forced triads, repeated sentence openings, dash-as-universal-connector.
7. Inflated significance, borrowed authority, sales language, "serves as / boasts" instead of is/has.
8. Decorative bold, emoji headings, Title Case headings.
9. Chatbot residue ("Great question!", "Hope this helps"), knowledge-limit disclaimers.
10. Re-explaining what the reader already knows — lead with the decision/action.

Invented facts are forbidden in non-fiction copy: names, numbers, dates, and quotes must come from project
data. Fiction may invent story details, but every name, date, number, and quote must stay consistent
with project data, and invented details must never be presented as real-world fact. When a needed
detail is missing, ask instead of guessing.

## Code

- Maintainability and modularity first. Code is concise; comments only for constraints the code
  cannot express (minimal comment principle). Delete filler comments whenever encountered.
- One consistent style. Split files before they get long (~400 lines); no single-file dumping ground.
- Extract reusable components and helpers instead of duplicating. Prefer composing small parts.
- Code serves the product; build from the infrastructure up (types → domain services → app layer → UI).

## UI & interaction

- Minimal narrative: no redundant micro-copy, no explanatory sub-labels under controls.
- Every text input has a cost. Prefer chips, segmented controls, selection-driven actions, and
  AI-drafted fields the user accepts or edits. A textarea is the last resort.
- The workstation mirrors a novelist's non-linear workflow (bible, corkboard, revision passes),
  never a linear wizard.
- Human–AI interaction is first-class: suggestions arrive as concrete, reviewable artifacts
  (diffs, cards, state proposals) with accept/reject, not as prose to retype.
- Story elements (characters, events, threads) are living state: they change per chapter, time,
  and location. Model them as versioned state over story-time, inject the right slice into
  generation, and propose updates after chapters are written.
- Agent loops keep a stable prefix (system + project context never rewritten mid-run) so provider
  caches hit and behavior stays deterministic. Context is built once per run, appended to, never
  reordered.

## AGENTS.md itself

This file records durable guidelines only. Never write session notes, task state, or memory-style
content here.
