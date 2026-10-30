import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const agentDir = resolve(__dirname, '..')
const pipelineDir = resolve(agentDir, '..', 'pipeline')

function readAgentFile(filename: string): string {
  return readFileSync(resolve(agentDir, filename), 'utf-8')
}

function readPipelineFile(filename: string): string {
  return readFileSync(resolve(pipelineDir, filename), 'utf-8')
}

describe('Agent Design Issues Verification', () => {
  describe('Issue 1: context typed as Record<string, any>', () => {
    it('should have context typed as Record<string, any> in BaseAgent', () => {
      const baseContent = readAgentFile('base.ts')
      expect(baseContent).toContain('buildPrompt(context: Record<string, any>)')
      expect(baseContent).toContain('handleToolCall(toolCall: ToolCall, _context: Record<string, any>)')
    })
  })

  describe('Issue 2: ChapterPlannerExpert no longer overrides execute() - FIXED', () => {
    it('should NOT have its own execute method (uses base class)', () => {
      const content = readAgentFile('chapterPlanner.ts')
      expect(content).not.toContain('async execute(context: Record<string, any>')
      expect(content).not.toContain('await this.executeWithTools(')
    })

    it('should import BaseAgent (not AgentResult) since execute is from base class', () => {
      const content = readAgentFile('chapterPlanner.ts')
      expect(content).toContain("import { BaseAgent } from './base'")
      expect(content).not.toContain('type AgentResult')
    })

    it('should NOT import injectCustomSystemPrompt (handled by base class)', () => {
      const content = readAgentFile('chapterPlanner.ts')
      expect(content).not.toContain("from '@/services/systemPrompt'")
    })
  })

  describe('Issue 3: EditingAIExpert replaced by DetailerExpert with config - FIXED', () => {
    it('should no longer have editingAI.ts file', () => {
      expect(() => readAgentFile('editingAI.ts')).toThrow()
    })

    it('should create editingAI via DetailerExpert constructor in index.ts', () => {
      const content = readAgentFile('index.ts')
      expect(content).toContain("new DetailerExpert('editingAI', 'Editing AI')")
      expect(content).not.toContain("from './editingAI'")
    })

    it('should still expose the editingAI agent in the registry', () => {
      const content = readAgentFile('index.ts')
      expect(content).toContain('editingAI:')
    })
  })

  describe('Issue 4: Duplicate validateCharacterRoleComposition - FIXED', () => {
    it('should have validateCharacterRoleComposition exported from validation.ts', () => {
      const content = readAgentFile('validation.ts')
      expect(content).toContain('export function validateCharacterRoleComposition')
    })

    it('should import shared function in storyPlanner.ts', () => {
      const content = readAgentFile('storyPlanner.ts')
      expect(content).toContain('validateCharacterRoleComposition')
      expect(content).not.toContain('private validateCharacterRoleComposition')
    })

    it('should import shared function in pipeline/planning.ts', () => {
      const content = readPipelineFile('planning.ts')
      expect(content).toContain('validateCharacterRoleComposition')
      expect(content).not.toContain('function validateCharacterRoleComposition(items: any[])')
    })
  })

  describe('Issue 5: ProofreaderExpert dead import - FIXED', () => {
    it('should NOT import sanitizeGeneratedChapterContent (dead import removed)', () => {
      const content = readAgentFile('proofreader.ts')
      expect(content).not.toContain('sanitizeGeneratedChapterContent')
      expect(content).toContain('buildWritingFormatInstruction')
    })
  })

  describe('Issue 6: ChapterTitlePlannerExpert no longer overrides execute() - FIXED', () => {
    it('should NOT have its own execute method (uses base class)', () => {
      const content = readAgentFile('chapterTitlePlanner.ts')
      expect(content).not.toContain('async execute(context: Record<string, any>')
      expect(content).not.toContain('await this.executeWithTools(')
    })

    it('should NOT import injectCustomSystemPrompt (handled by base class)', () => {
      const content = readAgentFile('chapterTitlePlanner.ts')
      expect(content).not.toContain("from '@/services/systemPrompt'")
    })

    it('should have context-independent getSystemPrompt() signature', () => {
      const content = readAgentFile('chapterTitlePlanner.ts')
      expect(content).toContain('protected getSystemPrompt(): string')
      expect(content).not.toContain('getSystemPrompt(context?: Record')
    })
  })

  describe('System Prompt now context-independent', () => {
    it('should mention both tools in ChapterTitlePlanner system prompt', () => {
      const content = readAgentFile('chapterTitlePlanner.ts')
      expect(content).toContain('create_chapter_titles')
      expect(content).toContain('create_next_chapter_title')
    })
  })
})
