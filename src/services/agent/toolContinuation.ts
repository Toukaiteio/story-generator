export interface ToolContinuationRequestInput {
  workflow: string
  rounds: number
  finalToolNames: string[]
}

type ToolContinuationHandler = (request: ToolContinuationRequestInput) => Promise<boolean>

// Event-based handler registry (replaces global mutable state)
const handlers = new Set<ToolContinuationHandler>()

export function setToolContinuationHandler(handler: ToolContinuationHandler) {
  handlers.clear()
  handlers.add(handler)
}

export function addToolContinuationHandler(handler: ToolContinuationHandler) {
  handlers.add(handler)
}

export function removeToolContinuationHandler(handler: ToolContinuationHandler) {
  handlers.delete(handler)
}

export async function requestToolContinuation(request: ToolContinuationRequestInput): Promise<boolean> {
  if (handlers.size === 0) return true
  
  // Execute all registered handlers, return true if any approves continuation
  const results = await Promise.all(Array.from(handlers).map(h => h(request)))
  return results.some(r => r === true)
}
