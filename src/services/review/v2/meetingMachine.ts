/**
 * Meeting v2 — Master-Worker Phase Machine
 *
 * Flow:
 *   idle → analysis → acting → done
 *                ↑___________|  (loop: master requests another round)
 *
 * - analysis: sub-agents (reviewers) run in parallel, each produces a short
 *   specialist report. Fast, focused, no cross-talk needed.
 * - acting: master agent reads all sub-agent reports + project context,
 *   then directly outputs a structured action OR a clarification request.
 *   No synthesis step, no voting, no proposer.
 * - done: action executed. Master can request another analysis round.
 *
 * Why this is faster:
 * - Parallel sub-agents instead of sequential round-robin
 * - Master acts directly instead of waiting for Proposer to synthesize
 * - No briefing phase (wasted LLM calls)
 * - No voting (single decision-maker)
 */

import type { AgentState, AgentTurnResult, MeetingPhase, PhaseState } from './types'

// ─── Events ───────────────────────────────────────────────────────────────────

export type MachineEvent =
  | { type: 'START'; focus: string }
  | { type: 'ANALYSIS_DONE' }
  | { type: 'MASTER_TURN_DONE'; result: AgentTurnResult }
  | { type: 'ACTION_APPLIED'; result: string }
  | { type: 'ACTION_FAILED'; error: string }
  | { type: 'USER_MESSAGE'; content: string }
  | { type: 'USER_END' }
  | { type: 'CLARIFICATION_ANSWERED'; answer: string }

// ─── Result ───────────────────────────────────────────────────────────────────

export interface TransitionResult {
  nextPhase: MeetingPhase
  phaseState: PhaseState
  /** Agent IDs to run next. Empty = wait for external trigger. */
  nextAgents: string[]
  systemMessage: string | null
}

// ─── Machine ──────────────────────────────────────────────────────────────────

export function createMeetingMachine() {
  function transition(
    current: PhaseState,
    agents: AgentState[],
    event: MachineEvent,
  ): TransitionResult {
    const enabled = agents.filter(a => a.enabled)
    const subAgents = enabled.filter(a => a.role === 'reviewer')
    const master = enabled.find(a => a.role === 'proposer')

    switch (event.type) {
      case 'START':
        return {
          nextPhase: 'analysis',
          phaseState: { ...current, phase: 'analysis', focus: event.focus, discussionTurns: 0, synthesisAttempts: 0 },
          nextAgents: subAgents.map(a => a.id),
          systemMessage: `Meeting started. Focus: ${event.focus}`,
        }

      case 'ANALYSIS_DONE':
        return {
          nextPhase: 'synthesis',
          phaseState: { ...current, phase: 'synthesis' },
          nextAgents: master ? [master.id] : [],
          systemMessage: null,
        }

      case 'USER_MESSAGE':
        return {
          nextPhase: 'analysis',
          phaseState: { ...current, phase: 'analysis', discussionTurns: 0, synthesisAttempts: 0 },
          nextAgents: subAgents.map(a => a.id),
          systemMessage: null,
        }

      case 'MASTER_TURN_DONE': {
        const intent = event.result.intent
        if (intent?.type === 'propose_action') {
          return {
            nextPhase: 'action',
            phaseState: { ...current, phase: 'action', synthesisAttempts: 0 },
            nextAgents: [],
            systemMessage: null,
          }
        }
        if (intent?.type === 'request_end') {
          return {
            nextPhase: 'ended',
            phaseState: { ...current, phase: 'ended' },
            nextAgents: [],
            systemMessage: `Meeting concluded: ${intent.reason}`,
          }
        }
        if (intent?.type === 'ask_user') {
          // Wait for clarification
          return {
            nextPhase: 'synthesis',
            phaseState: { ...current, phase: 'synthesis' },
            nextAgents: [],
            systemMessage: null,
          }
        }
        // Master produced no action — retry once, then ask user
        const attempts = current.synthesisAttempts + 1
        if (attempts >= 2) {
          return {
            nextPhase: 'synthesis',
            phaseState: { ...current, phase: 'synthesis', synthesisAttempts: attempts },
            nextAgents: [],
            systemMessage: 'Master agent could not determine a concrete action. Please provide more direction.',
          }
        }
        return {
          nextPhase: 'synthesis',
          phaseState: { ...current, phase: 'synthesis', synthesisAttempts: attempts },
          nextAgents: master ? [master.id] : [],
          systemMessage: 'Master agent retrying — must produce a concrete action or ask for clarification.',
        }
      }

      case 'ACTION_APPLIED':
        return {
          nextPhase: 'synthesis',
          phaseState: { ...current, phase: 'synthesis', synthesisAttempts: 0 },
          nextAgents: master ? [master.id] : [],
          systemMessage: `Action applied. ${event.result}`,
        }

      case 'ACTION_FAILED':
        return {
          nextPhase: 'synthesis',
          phaseState: { ...current, phase: 'synthesis', synthesisAttempts: 0 },
          nextAgents: master ? [master.id] : [],
          systemMessage: `Action failed: ${event.error}. Master will decide next step.`,
        }

      case 'CLARIFICATION_ANSWERED':
        return {
          nextPhase: 'synthesis',
          phaseState: { ...current, phase: 'synthesis', synthesisAttempts: 0 },
          nextAgents: master ? [master.id] : [],
          systemMessage: `User answered: ${event.answer}`,
        }

      case 'USER_END':
        return {
          nextPhase: 'ended',
          phaseState: { ...current, phase: 'ended' },
          nextAgents: [],
          systemMessage: 'Meeting ended by user.',
        }
    }
  }

  return { transition }
}

export function isTerminalPhase(phase: MeetingPhase): boolean {
  return phase === 'ended'
}
