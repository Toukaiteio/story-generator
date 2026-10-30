import type { ProviderProxyRequest, ProviderProxyResponse, ProviderStreamEvent } from './transportTypes'

export type { ProviderProxyRequest, ProviderProxyResponse, ProviderStreamEvent } from './transportTypes'

const nativeFetch = globalThis.fetch.bind(globalThis)

function getElectronProviderApi() {
  if (typeof window === 'undefined') return null
  return window.electronAPI?.provider ?? null
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `provider-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createAbortError() {
  const error = new Error('The provider request was aborted.')
  error.name = 'AbortError'
  return error
}

async function serializeBody(body: BodyInit | null | undefined): Promise<string | undefined> {
  if (body == null) return undefined
  if (typeof body === 'string') return body
  return new Response(body).text()
}

async function normalizeRequest(input: RequestInfo | URL, init?: RequestInit): Promise<ProviderProxyRequest> {
  const source = input instanceof Request ? input : null
  const url = source?.url ?? (input instanceof URL ? input.toString() : String(input))
  const headers = new Headers(source?.headers)
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value))

  let body = init?.body
  if (body == null && source) {
    body = await source.clone().text()
  }

  return {
    requestId: createRequestId(),
    url,
    method: String(init?.method ?? source?.method ?? 'GET').toUpperCase(),
    headers: Object.fromEntries(headers.entries()),
    body: await serializeBody(body),
  }
}

function isStreamingRequest(request: ProviderProxyRequest) {
  if (request.body) {
    try {
      const payload = JSON.parse(request.body)
      if (payload?.stream === true) return true
    } catch {
      // Some SDKs use query parameters rather than a stream flag in the body.
    }
  }

  try {
    const url = new URL(request.url)
    return url.searchParams.get('alt') === 'sse' || /streamGenerateContent/i.test(url.pathname)
  } catch {
    return false
  }
}

function decodeChunk(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function responseFromProxy(response: ProviderProxyResponse) {
  return new Response(response.body ?? '', {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

async function fetchThroughElectron(
  request: ProviderProxyRequest,
  signal?: AbortSignal
): Promise<Response> {
  const api = getElectronProviderApi()
  if (!api?.request) return nativeFetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal,
  })

  if (signal?.aborted) throw createAbortError()

  const cancel = () => api.cancelRequest?.(request.requestId)
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const response = await api.request(request)
    return responseFromProxy(response)
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

async function streamThroughElectron(
  request: ProviderProxyRequest,
  signal?: AbortSignal
): Promise<Response> {
  const api = getElectronProviderApi()
  if (!api?.startStream) return nativeFetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal,
  })

  if (signal?.aborted) throw createAbortError()

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let streamClosed = false
  let streamError: Error | null = null
  const cancel = () => api.cancelStream?.(request.requestId)
  const removeAbortListener = () => signal?.removeEventListener('abort', cancel)

  const responseBody = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController
      if (streamError) {
        nextController.error(streamError)
      } else if (streamClosed) {
        nextController.close()
      }
    },
    cancel() {
      api.cancelStream?.(request.requestId)
    },
  })
  const getController = (): ReadableStreamDefaultController<Uint8Array> | null => controller

  const handleEvent = (event: ProviderStreamEvent) => {
    if (event.type === 'chunk' && event.data) {
      controller?.enqueue(decodeChunk(event.data))
      return
    }

    if (event.type === 'end') {
      streamClosed = true
      removeAbortListener()
      controller?.close()
      return
    }

    const error = new Error(event.error?.message || 'Provider stream failed.')
    error.name = event.error?.name || 'Error'
    streamError = error
    removeAbortListener()
    controller?.error(error)
  }

  signal?.addEventListener('abort', cancel, { once: true })

  try {
    const response = await api.startStream(request.requestId, request, handleEvent)
    if (!response.ok) {
      streamClosed = true
      removeAbortListener()
      getController()?.close()
      return responseFromProxy(response)
    }

    if (signal?.aborted) {
      cancel()
      throw createAbortError()
    }

    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    streamError = normalized
    removeAbortListener()
    getController()?.error(normalized)
    throw normalized
  } finally {
    if (streamError || streamClosed) removeAbortListener()
  }
}

export async function providerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const api = getElectronProviderApi()
  if (!api?.request && !api?.startStream) return nativeFetch(input, init)

  const request = await normalizeRequest(input, init)
  const signal = init?.signal ?? undefined
  return isStreamingRequest(request)
    ? streamThroughElectron(request, signal)
    : fetchThroughElectron(request, signal)
}

/**
 * The Google SDK captures the global fetch implementation when its client is
 * constructed. Temporarily install the same transport so Google requests use
 * the Electron main-process proxy as well.
 */
export function withProviderFetch<T>(factory: () => T): T {
  const originalFetch = globalThis.fetch
  globalThis.fetch = providerFetch
  try {
    return factory()
  } finally {
    globalThis.fetch = originalFetch
  }
}
