export interface ToolContinuationRequestInput {
  workflow: string
  rounds: number
  finalToolNames: string[]
}

type ToolContinuationHandler = (request: ToolContinuationRequestInput) => Promise<boolean>

let handler: ToolContinuationHandler | null = null

export function setToolContinuationHandler(nextHandler: ToolContinuationHandler) {
  handler = nextHandler
}

export async function requestToolContinuation(request: ToolContinuationRequestInput) {
  if (!handler) return true
  return handler(request)
}
