import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import electronRenderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'
import type { IncomingMessage, ServerResponse } from 'http'

function buildModelListEndpoints(type: 'openai' | 'anthropic', baseUrl: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  const endpoints = type === 'anthropic'
    ? [
        normalizedBase.endsWith('/v1') ? `${normalizedBase}/models` : `${normalizedBase}/v1/models`,
        normalizedBase.endsWith('/v1') ? `${normalizedBase.replace(/\/v1$/, '')}/v1/models` : `${normalizedBase}/models`,
      ]
    : [
        `${normalizedBase}/models`,
        normalizedBase.endsWith('/v1') ? `${normalizedBase.replace(/\/v1$/, '')}/v1/models` : `${normalizedBase}/v1/models`,
      ]

  return [...new Set(endpoints.filter(Boolean))]
}

async function readRequestJson(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

function providerModelProxy() {
  return {
    name: 'provider-model-proxy',
    configureServer(server: any) {
      server.middlewares.use('/api/provider/list-models', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.method !== 'POST') {
          next()
          return
        }

        try {
          const body = await readRequestJson(req)
          const type = body?.type === 'anthropic' ? 'anthropic' : 'openai'
          const baseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl : ''
          const apiKey = typeof body?.apiKey === 'string' ? body.apiKey : ''

          if (!baseUrl) {
            sendJson(res, 400, { error: 'Invalid provider model sync request' })
            return
          }

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          }

          if (type === 'openai' && apiKey) {
            headers.Authorization = `Bearer ${apiKey}`
          } else if (type === 'anthropic') {
            headers['anthropic-version'] = '2023-06-01'
            if (apiKey) {
              headers['x-api-key'] = apiKey
            }
          }

          const endpoints = buildModelListEndpoints(type, baseUrl)
          let lastError: Error | null = null

          for (const endpoint of endpoints) {
            try {
              const response = await fetch(endpoint, {
                method: 'GET',
                headers,
              })

              if (response.ok) {
                sendJson(res, 200, await response.json())
                return
              }

              const text = await response.text()
              lastError = new Error(`${type} API error: ${response.status} - ${text}`)
            } catch (error: any) {
              lastError = error instanceof Error ? error : new Error(String(error))
            }
          }

          sendJson(res, 502, {
            error: `${type} model sync failed after trying: ${endpoints.join(' | ')}${lastError ? `; last error: ${lastError.message}` : ''}`,
          })
        } catch (error: any) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })

      server.middlewares.use('/api/provider/create-embedding', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.method !== 'POST') {
          next()
          return
        }

        try {
          const body = await readRequestJson(req)
          const type = body?.type === 'anthropic' ? 'anthropic' : 'openai'
          const baseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl : ''
          const apiKey = typeof body?.apiKey === 'string' ? body.apiKey : ''
          const model = typeof body?.model === 'string' ? body.model : ''
          const text = typeof body?.text === 'string' ? body.text : ''

          if (!baseUrl || !model || !text) {
            sendJson(res, 400, { error: 'Invalid provider embedding request' })
            return
          }

          if (type === 'anthropic') {
            sendJson(res, 400, { error: 'Anthropic embedding is not supported in this app' })
            return
          }

          const normalizedBase = baseUrl.replace(/\/+$/, '')
          const endpoints = [
            `${normalizedBase}/embeddings`,
            normalizedBase.endsWith('/v1') ? `${normalizedBase.replace(/\/v1$/, '')}/v1/embeddings` : `${normalizedBase}/v1/embeddings`,
          ]

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          }
          if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`
          }

          let lastError: Error | null = null
          for (const endpoint of endpoints) {
            try {
              const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify({ model, input: text }),
              })

              if (response.ok) {
                sendJson(res, 200, await response.json())
                return
              }

              const responseText = await response.text()
              lastError = new Error(`API error: ${response.status} - ${responseText}`)
            } catch (error: any) {
              lastError = error instanceof Error ? error : new Error(String(error))
            }
          }

          sendJson(res, 502, {
            error: `embedding request failed after trying: ${endpoints.join(' | ')}${lastError ? `; last error: ${lastError.message}` : ''}`,
          })
        } catch (error: any) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [
    providerModelProxy(),
    vue(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    electronRenderer(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
