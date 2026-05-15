# Story Generator

[中文说明 (README_CN)](./README_CN.md)

A desktop-first, multi-agent story creation workspace built with Vue 3 + Electron.

This project helps you go from story configuration to outline, chapter planning, writing, proofreading, and polishing with AI-assisted workflows.

## What It Does

- Project-based story authoring workflow
- Story planning with outline + character management
- Chapter planning and chapter writing workspaces
- AI sidebar (`Vibe AI`) with tool-based edits
- Optional review/proofread/polish stages
- Local persistence for project data and chat history

## Tech Stack

- Vue 3 + Vite
- TypeScript + Pinia
- Electron + electron-builder

## Quick Start

1. Install dependencies

```bash
pnpm install
```

2. Run in development mode

```bash
pnpm dev
```

3. Build web assets

```bash
pnpm build
```

4. Build desktop package

```bash
pnpm electron:build
```

## WalkThrough (5-10 minutes)

1. Create/open a project.
2. Fill Story Configuration:
   - Theme / Genre / Primary Language
   - Chapter count and constraints (required/forbidden elements)
3. Go to **Story Planning**:
   - Draft or AI-generate the **master story outline** (global story arc)
   - Create or adjust characters
4. Go to **Chapter Plan**:
   - For each chapter, complete: title, objective, conflict, key events, character actions, reveals, ending hook
5. Use the right-side **Vibe AI**:
   - Ask for targeted edits (outline fields, chapter content, style refinements)
   - Review tool execution and apply results
6. Continue with **Writing** and optional **Proofreading / Polishing**.
7. Save and reopen the app to verify data persistence.

## Notes

- This repository currently has no strict `typecheck` npm script; use:

```bash
npx vue-tsc --noEmit
```

- If your environment has `spawn EPERM` during build, run commands with proper permissions and retry.
