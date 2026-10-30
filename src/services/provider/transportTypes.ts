export interface ProviderProxyRequest {
  requestId: string
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

export interface ProviderProxyResponse {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
}

export interface ProviderStreamEvent {
  requestId: string
  type: 'chunk' | 'end' | 'error'
  data?: string
  error?: {
    name?: string
    message: string
  }
}
