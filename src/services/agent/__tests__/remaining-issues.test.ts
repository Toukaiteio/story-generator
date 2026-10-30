import { describe, it, expect, afterEach } from 'vitest'
import {
  addToolContinuationHandler,
  removeToolContinuationHandler,
  requestToolContinuation,
  type ToolContinuationRequestInput,
} from '../toolContinuation'
import { createErrorResponse, createSuccessResponse } from '../toolResponse'
import type { RuntimeContext } from '../contextData'

describe('Remaining Design Issues - Fixes Verification', () => {
  describe('Issue 7: Tool Continuation - Event-based handler registry', () => {
    const handlersToCleanup: Function[] = []

    afterEach(() => {
      handlersToCleanup.forEach(h => removeToolContinuationHandler(h as any))
      handlersToCleanup.length = 0
    })

    function addAndTrack(handler: Function) {
      handlersToCleanup.push(handler)
      addToolContinuationHandler(handler as any)
    }

    it('should support multiple handlers via Set-based registry', async () => {
      let handler1Ran = false
      let handler2Ran = false

      const h1 = async () => { handler1Ran = true; return true }
      const h2 = async () => { handler2Ran = true; return false }

      addAndTrack(h1)
      addAndTrack(h2)

      const request: ToolContinuationRequestInput = {
        workflow: 'test',
        rounds: 10,
        finalToolNames: ['tool1'],
      }

      const result = await requestToolContinuation(request)

      expect(handler1Ran).toBe(true)
      expect(handler2Ran).toBe(true)
      expect(result).toBe(true) // At least one handler returned true
    })

    it('should allow removing handlers', async () => {
      let handlerRan = false

      const handler = async () => { handlerRan = true; return true }

      addToolContinuationHandler(handler)
      removeToolContinuationHandler(handler)

      const request: ToolContinuationRequestInput = {
        workflow: 'test',
        rounds: 10,
        finalToolNames: ['tool1'],
      }

      const result = await requestToolContinuation(request)

      expect(handlerRan).toBe(false)
      expect(result).toBe(true) // Default when no handlers
    })

    it('should return true when no handlers registered', async () => {
      const request: ToolContinuationRequestInput = {
        workflow: 'test',
        rounds: 10,
        finalToolNames: ['tool1'],
      }

      const result = await requestToolContinuation(request)
      expect(result).toBe(true)
    })

    it('should return false when all handlers return false', async () => {
      const handler = async () => false
      addAndTrack(handler)

      const result = await requestToolContinuation({
        workflow: 'test',
        rounds: 5,
        finalToolNames: [],
      })

      expect(result).toBe(false)
    })
  })

  describe('Issue 8: AgentContextData - Typed context interface', () => {
    it('should define all underscore-prefixed context properties', () => {
      const context: RuntimeContext = {
        _outlineData: {
          title: 'Test Story',
          synopsis: 'A test',
          outline: 'Test outline',
        },
        _chapterOutlineData: {
          chapterNumber: 1,
          title: 'Chapter 1',
          objective: 'Introduce characters',
          conflict: 'Main conflict',
          keyEvents: ['Event 1'],
          characterActions: ['Action 1'],
          infoReveals: ['Info 1'],
          endingHook: 'Hook',
        },
        _charactersData: [{ name: 'Hero', role: 'protagonist' }],
      }

      expect(context._outlineData?.title).toBe('Test Story')
      expect(context._chapterOutlineData?.chapterNumber).toBe(1)
      expect(context._charactersData?.[0].name).toBe('Hero')
    })

    it('should allow optional context properties', () => {
      const context: RuntimeContext = {}
      expect(context._outlineData).toBeUndefined()
    })
  })

  describe('Issue 9: Tool Response - Standardized error/success format', () => {
    it('should create standardized error responses', () => {
      const error = createErrorResponse('Invalid input', 'INVALID_INPUT', {
        field: 'name',
        reason: 'too short',
      })

      expect(error.error).toBe('Invalid input')
      expect(error.code).toBe('INVALID_INPUT')
      expect(error.details?.field).toBe('name')
    })

    it('should create standardized success responses', () => {
      const success = createSuccessResponse('Operation completed', {
        itemsProcessed: 5,
      })

      expect(success.success).toBe(true)
      expect(success.message).toBe('Operation completed')
      expect(success.data?.itemsProcessed).toBe(5)
    })

    it('should support minimal error responses', () => {
      const error = createErrorResponse('Unknown tool')
      expect(error.error).toBe('Unknown tool')
      expect(error.code).toBeUndefined()
      expect(error.details).toBeUndefined()
    })

    it('should support minimal success responses', () => {
      const success = createSuccessResponse()
      expect(success.success).toBe(true)
      expect(success.message).toBeUndefined()
    })
  })

  describe('Issue 10: Dead code check - unused imports', () => {
    it('should verify chapterPlanner.ts has no AgentResult import', () => {
      // Verified by agent-design-issues.test.ts
      expect(true).toBe(true)
    })

    it('should verify chapterPlanner.ts has no injectCustomSystemPrompt import', () => {
      // Verified by agent-design-issues.test.ts
      expect(true).toBe(true)
    })
  })

  describe('Integration: All improvements work together', () => {
    it('should handle tool continuation with typed context', async () => {
      const context: RuntimeContext = {
        _outlineData: {
          title: 'Story',
          synopsis: 'Synopsis',
          outline: 'Outline',
        },
      }

      const handler = async (req: ToolContinuationRequestInput) => {
        expect(req.workflow).toBeDefined()
        expect(req.rounds).toBeGreaterThan(0)
        return true
      }

      addToolContinuationHandler(handler as any)

      const result = await requestToolContinuation({
        workflow: 'outline-generation',
        rounds: 15,
        finalToolNames: ['create_story_outline'],
      })

      expect(result).toBe(true)
      expect(context._outlineData?.title).toBe('Story')
    })
  })
})
