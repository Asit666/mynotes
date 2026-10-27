import type { GeneratedNote } from './models'

export type AiProvider = 'OPENAI' | 'ANTHROPIC' | 'GEMINI'

export interface ProviderStatus {
  id: AiProvider
  name: string
  configured: boolean
}

export interface GenerateNoteRequest {
  provider: AiProvider
  model: string
  videoTitle: string
  videoUrl: string
  timestampSeconds: number
  transcriptText: string
  screenshotBase64?: string
}

export interface GeneratedNoteResponse {
  title: string
  explanation: string
  keyPoints: string[]
  startTimestampSeconds: number
}

export interface GenerateSummaryRequest {
  provider: AiProvider
  model: string
  videoTitle: string
  videoUrl: string
  fullNotesMarkdown: string
}

export interface GeneratedSummaryResponse {
  title: string
  executiveSummary: string
  coreThemes: string[]
  keyTakeaways: string[]
  reviewQuestions: string[]
  formattedMarkdown: string
  generatedAt: string
}

export interface AskNoteRequest {
  provider: AiProvider
  model: string
  videoTitle: string
  videoUrl?: string
  prompt: string
  existingNotesContext?: string
  timestampSeconds?: number
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
          if (typeof error.message === 'string' && error.message.length > 0) {
            detail = error.message
          }
        } catch {
          // Response body was not JSON
        }
        const serverError = new Error(detail)
        ;(serverError as unknown as { isServerError: boolean }).isServerError = true
        throw serverError
      }
      if (response.status === 204) return undefined as T
      return await response.json() as T
    } catch (error) {
      lastError = error
      if (error && typeof error === 'object' && 'isServerError' in error) {
        throw error
      }
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

export async function generateSummary(requestBody: GenerateSummaryRequest): Promise<GeneratedSummaryResponse> {
  const response = await request<GeneratedSummaryResponse>('/api/notes/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })
  if (!response || typeof response.formattedMarkdown !== 'string') {
    throw new Error('The summary service returned an invalid summary.')
  }
  return response
}

export async function askNote(requestBody: AskNoteRequest): Promise<GeneratedNoteResponse> {
  const response = await request<unknown>('/api/notes/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })
  if (!isGeneratedNote(response)) throw new Error('The notes service returned an invalid note.')
  return response
}
