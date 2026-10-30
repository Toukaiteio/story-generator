# Application layer (`src/app`)

This folder is the **only** boundary the UI is allowed to use for engine
capabilities.

```
src/components, src/pages, src/layouts   (UI)
            │
            ▼
        src/app                          (ports + use cases)
            │
            ▼
src/stores/*, src/services/*             (engine: providers, agents, pipeline, data)
```

## Rules

1. UI components/pages/layouts must not import `@/services/**` or engine stores
   (`@/stores/project`, `@/stores/provider`, `@/stores/generation`,
   `@/stores/knowledge`, `@/stores/writingStyle`).
2. UI view state stays in `@/stores/ui`. Locale/i18n stays in `@/i18n`.
3. Engine-specific types are re-exported from `@/app`; domain DTOs stay in
   `@/types`.
4. `src/app/engine.ts` is the AI surface (`useStoryEngine`). It hides the
   generation store, provider manager and agent registry behind a single,
   swappable interface.
5. `src/app/textTools.ts` exposes pure formatting/rendering helpers so the UI
   never needs an engine module path just to render text.

The boundary is enforced by `src/app/__tests__/boundaries.test.ts`.
