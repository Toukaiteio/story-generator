import { useProviderStore } from '@/stores/provider'
import { getRelationshipQueryTools } from '@/services/relationship/tools'
import { chatWithRelationshipTools, chatWithRelationshipToolsInPlace, getToolCall } from '@/services/generation/toolWorkflow'
import { getChapterIssueReportTool, getEditingAuditSystemPrompt, getProofreadingSystemPrompt, getProofreadingTools, mapEditingAuditIssues, mapProofreadingIssues } from '@/services/generation/proofreadingTools'
import { buildSegmentedProofreadingPrompts, buildProofreadingSegments } from '@/services/proofreading/chunking'
import type { ProviderModelRef, ChatMessage } from '@/types/provider'
import type { ChapterAuditIssue } from '@/services/generation/types'

export async function auditChapterWithToolWorkflow(
  prompt: string,
  modelRef: ProviderModelRef,
  project: any,
  getModelContextTokens: (modelRef: ProviderModelRef) => number | null,
  signal: AbortSignal | undefined,
  waitForToolContinuation: (request: any) => Promise<boolean>
): Promise<ChapterAuditIssue[]> {
  const tools = [
    ...getRelationshipQueryTools(),
    getChapterIssueReportTool(),
  ]

  const messages: ChatMessage[] = [
    { role: 'system', content: getEditingAuditSystemPrompt() },
    { role: 'user', content: prompt },
  ]

  const response = await chatWithRelationshipTools(messages, modelRef, tools, {
    project,
    finalToolNames: ['report_chapter_issues'],
    contextTokens: getModelContextTokens(modelRef),
    maxTokens: 4096,
    temperature: 0.2,
    maxRounds: useProviderStore().toolWorkflowSettings.maxToolCallRounds,
    signal,
    requestContinuation: waitForToolContinuation,
  })
  const toolCall = getToolCall(response.tool_calls, 'report_chapter_issues')
  const rawIssues = Array.isArray(toolCall?.arguments?.issues) ? toolCall.arguments.issues : []
  return mapEditingAuditIssues(rawIssues)
}

export async function proofreadChapterWithToolWorkflow(
  prompt: string,
  modelRef: ProviderModelRef,
  project: any,
  getModelContextTokens: (modelRef: ProviderModelRef) => number | null,
  signal: AbortSignal | undefined,
  waitForToolContinuation: (request: any) => Promise<boolean>
): Promise<ChapterAuditIssue[]> {
  const tools = getProofreadingTools()
  const messages: ChatMessage[] = [
    { role: 'system', content: getProofreadingSystemPrompt() },
    { role: 'user', content: prompt },
  ]

  const response = await chatWithRelationshipTools(messages, modelRef, tools, {
    project,
    finalToolNames: ['report_proofreading_issues'],
    contextTokens: getModelContextTokens(modelRef),
    maxTokens: 4096,
    temperature: 0.2,
    maxRounds: useProviderStore().toolWorkflowSettings.maxToolCallRounds,
    signal,
    requestContinuation: waitForToolContinuation,
  })
  const toolCall = getToolCall(response.tool_calls, 'report_proofreading_issues')
  const rawIssues = Array.isArray(toolCall?.arguments?.issues) ? toolCall.arguments.issues : []
  return mapProofreadingIssues(rawIssues)
}

export async function proofreadChapterWithToolChunkedWorkflow(
  prompt: string,
  runSegment: (prompt: string) => Promise<ChapterAuditIssue[]>,
  cancelled: () => boolean,
  setProgress: (message: string) => void,
  options?: {
    onSegmentComplete?: (payload: {
      segmentIndex: number
      segmentTotal: number
      segmentIssues: ChapterAuditIssue[]
      allIssues: ChapterAuditIssue[]
    }) => Promise<void> | void
  }
): Promise<ChapterAuditIssue[]> {
  const chunks = buildSegmentedProofreadingPrompts(prompt)
  const issues: ChapterAuditIssue[] = []
  for (let index = 0; index < chunks.length; index++) {
    if (cancelled()) break
    setProgress(`Proofreading segment ${index + 1}/${chunks.length}...`)
    const chunkIssues = await runSegment(chunks[index].prompt)
    const range = chunks[index].range
    const segmentIssues = chunkIssues.map(issue => ({
      ...issue,
      id: `${issue.id}-part-${index + 1}`,
      segmentIndex: range.index,
      segmentTotal: range.total,
      segmentCharStart: range.charStart,
      segmentCharEnd: range.charEnd,
      segmentTokenStart: range.tokenStart,
      segmentTokenEnd: range.tokenEnd,
      segmentTokenTotal: range.tokenTotal,
    }))
    issues.push(...segmentIssues)
    await options?.onSegmentComplete?.({
      segmentIndex: index,
      segmentTotal: chunks.length,
      segmentIssues,
      allIssues: [...issues],
    })
  }
  return issues
}

export async function proofreadChapterContentWithToolWorkflow(
  contextPrompt: string,
  content: string,
  modelRef: ProviderModelRef,
  project: any,
  getModelContextTokens: (modelRef: ProviderModelRef) => number | null,
  signal: AbortSignal | undefined,
  waitForToolContinuation: (request: any) => Promise<boolean>,
  cancelled: () => boolean,
  setProgress: (message: string) => void,
  options?: {
    onSegmentStart?: (payload: {
      segmentIndex: number
      segmentTotal: number
    }) => Promise<void> | void
    onSegmentComplete?: (payload: {
      segmentIndex: number
      segmentTotal: number
      segmentIssues: ChapterAuditIssue[]
      allIssues: ChapterAuditIssue[]
    }) => Promise<void> | void
  }
): Promise<ChapterAuditIssue[]> {
  const segments = buildProofreadingSegments(content)
  const issues: ChapterAuditIssue[] = []
  const prefix = contextPrompt.trim()
  const tools = getProofreadingTools()

  for (let index = 0; index < segments.length; index++) {
    if (cancelled()) break
    const segment = segments[index]
    setProgress(`Proofreading segment ${index + 1}/${segments.length}...`)
    await options?.onSegmentStart?.({
      segmentIndex: index,
      segmentTotal: segments.length,
    })
    const segmentPrompt = [
      prefix,
      '',
      `Current Chapter Segment ${segment.index + 1}/${segment.total}:`,
      `Estimated token range: ${segment.tokenStart}-${segment.tokenEnd} of ${segment.tokenTotal}.`,
      'Task: inspect this segment line by line and call report_proofreading_issues. Report grammar, typo, wording, punctuation, consistency, pacing, and logic issues with exact excerpts from this segment. Use an empty issues array only when this segment has no concrete issues.',
      '',
      'Segment Text:',
      segment.content,
    ].join('\n')
    const messages: ChatMessage[] = [
      { role: 'system', content: getProofreadingSystemPrompt() },
      { role: 'user', content: segmentPrompt },
    ]
    const response = await chatWithRelationshipToolsInPlace(messages, modelRef, tools, {
      project,
      finalToolNames: ['report_proofreading_issues'],
      contextTokens: getModelContextTokens(modelRef),
      maxTokens: 4096,
      temperature: 0.2,
      maxRounds: useProviderStore().toolWorkflowSettings.maxToolCallRounds,
      signal,
      requestContinuation: waitForToolContinuation,
      finalToolResultContent: toolCall => JSON.stringify({
        ok: true,
        segment: `${segment.index + 1}/${segment.total}`,
        issueCount: Array.isArray(toolCall.arguments?.issues) ? toolCall.arguments.issues.length : 0,
      }),
    })
    const toolCall = getToolCall(response.tool_calls, 'report_proofreading_issues')
    const rawIssues = Array.isArray(toolCall?.arguments?.issues) ? toolCall.arguments.issues : []
    const chunkIssues = mapProofreadingIssues(rawIssues)
    const segmentIssues = chunkIssues.map(issue => ({
      ...issue,
      id: `${issue.id}-part-${index + 1}`,
      segmentIndex: segment.index,
      segmentTotal: segment.total,
      segmentCharStart: segment.charStart,
      segmentCharEnd: segment.charEnd,
      segmentTokenStart: segment.tokenStart,
      segmentTokenEnd: segment.tokenEnd,
      segmentTokenTotal: segment.tokenTotal,
    }))
    issues.push(...segmentIssues)
    await options?.onSegmentComplete?.({
      segmentIndex: index,
      segmentTotal: segments.length,
      segmentIssues,
      allIssues: [...issues],
    })
  }

  return issues
}
