import type { GeneratedNote } from './models'
import { sendExtensionMessage } from './chrome'

export type AiProvider = 'OPENAI' | 'ANTHROPIC' | 'GEMINI'

export interface ProviderStatus {
  id: AiProvider
  name: string
  configured: boolean
}

interface GenerateNoteRequest {
  provider: AiProvider
  model: string
  videoTitle: string
  videoUrl: string
  timestampSeconds: number
  transcriptText: string
  screenshotBase64?: string
}

interface GeneratedNoteResponse {
  title: string
  explanation: string
  keyPoints: string[]
  startTimestampSeconds: number
}

interface ProviderValidation {
  models: string[]
}

const candidateUrls = Array.from(new Set([
  import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8080',
  'http://127.0.0.1:8080',
  'http://localhost:8080',
]))

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let lastError: unknown
  for (const baseUrl of candidateUrls) {
    try {
      const response = await fetch(`${baseUrl}${path}`, init)
      if (!response.ok) {
        let detail = `The notes service returned HTTP ${response.status}.`
        try {
          const error = await response.json() as { message?: unknown }
          if (typeof error.message === 'string' && error.message.length > 0) detail = error.message
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error
        }
        throw new Error(detail)
      }
      if (response.status === 204) return undefined as T
      return await response.json() as T
    } catch (error) {
      lastError = error
      if (error instanceof Error && error.message.includes('The notes service returned HTTP')) {
        throw error
      }
    }
  }

  try {
    const bgResponse = await sendExtensionMessage({
      type: 'BACKEND_FETCH',
      path,
      init: init ? {
        method: init.method,
        headers: init.headers as Record<string, string>,
        body: typeof init.body === 'string' ? init.body : undefined,
      } : undefined,
    })
    if (bgResponse.success) {
      return bgResponse.data as T
    }
    if (bgResponse.error) {
      throw new Error(bgResponse.error)
    }
  } catch (bgError) {
    if (bgError instanceof Error && !bgError.message.includes('Receiving end does not exist')) {
      throw bgError
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Could not connect to the local notes backend.')
}

export function listProviders(): Promise<ProviderStatus[]> {
  return request('/api/settings/providers')
}

export async function saveProviderKey(provider: AiProvider, apiKey: string): Promise<string[]> {
  const validation = await request<ProviderValidation>(`/api/settings/providers/${provider}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })
  await request(`/api/settings/providers/${provider}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })
  return validation.models
}

export function removeProviderKey(provider: AiProvider): Promise<void> {
  return request(`/api/settings/providers/${provider}`, { method: 'DELETE' })
}

export function listProviderModels(provider: AiProvider): Promise<string[]> {
  return request(`/api/ai/models?provider=${encodeURIComponent(provider)}`)
}

export async function transcribeAudio(audioBase64: string): Promise<string> {
  const response = await request<{ transcriptText: unknown }>('/api/notes/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audioBase64 }),
  })
  if (typeof response.transcriptText !== 'string') {
    throw new Error('The transcription service returned an invalid transcript.')
  }
  return response.transcriptText
}

function isGeneratedNote(value: unknown): value is GeneratedNoteResponse {
  if (typeof value !== 'object' || value === null) return false

  const note = value as Record<string, unknown>
  return typeof note.title === 'string'
    && typeof note.explanation === 'string'
    && Array.isArray(note.keyPoints)
    && note.keyPoints.every((point) => typeof point === 'string')
    && typeof note.startTimestampSeconds === 'number'
}

export async function generateNote(requestBody: GenerateNoteRequest): Promise<GeneratedNoteResponse> {
  const response = await request<unknown>('/api/notes/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })
  if (!isGeneratedNote(response)) throw new Error('The notes service returned an invalid note.')
  return response
}

export function toLocalNote(
  response: GeneratedNoteResponse,
  sessionId: string,
  captureId: string,
): GeneratedNote {
  const now = Date.now()
  return {
    ...response,
    id: crypto.randomUUID(),
    sessionId,
    captureId,
    createdAt: now,
    updatedAt: now,
    userEdited: false,
  }
}
