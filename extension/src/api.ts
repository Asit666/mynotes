import type { GeneratedNote } from './models'

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
}

interface GeneratedNoteResponse {
  title: string
  explanation: string
  keyPoints: string[]
  startTimestampSeconds: number
}

const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8080'

function isGeneratedNote(value: unknown): value is GeneratedNoteResponse {
  if (typeof value !== 'object' || value === null) return false

  const note = value as Record<string, unknown>
  return typeof note.title === 'string'
    && typeof note.explanation === 'string'
    && Array.isArray(note.keyPoints)
    && note.keyPoints.every((point) => typeof point === 'string')
    && typeof note.startTimestampSeconds === 'number'
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, init)
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
}

export function listProviders(): Promise<ProviderStatus[]> {
  return request('/api/settings/providers')
}

export function saveProviderKey(provider: AiProvider, apiKey: string): Promise<void> {
  return request(`/api/settings/providers/${provider}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })
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
