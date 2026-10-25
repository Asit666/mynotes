export type SessionStatus = 'active' | 'paused' | 'completed'
export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'

export interface LearningSession {
  id: string
  videoId: string
  videoUrl: string
  videoTitle: string
  platformName?: string
  tabId: number
  startedAt: number
  endedAt?: number
  captureIntervalSeconds: number
  captureAudio?: boolean
  status: SessionStatus
}

export interface VideoSnapshot {
  videoId: string
  videoUrl: string
  videoTitle: string
  timestampSeconds: number
  durationSeconds: number
  isPlaying: boolean
  transcriptText: string
  platformName: string
}

export interface VideoCapture {
  id: string
  sessionId: string
  timestampSeconds: number
  capturedAt: number
  transcriptText: string
  screenshotDataUrl?: string
  screenshotError?: string
  audioBase64?: string
  processingStatus: ProcessingStatus
  processingError?: string
}

export interface GeneratedNote {
  id: string
  sessionId: string
  captureId?: string
  title: string
  explanation: string
  keyPoints: string[]
  startTimestampSeconds: number
  createdAt: number
  updatedAt: number
  userEdited: boolean
}

export type ExtensionMessage =
  | { type: 'UI_GET_STATE' }
  | { type: 'PAGE_CONNECT' }
  | { type: 'AUDIO_START'; streamId: string }
  | { type: 'AUDIO_FLUSH' }
  | { type: 'AUDIO_PAUSE' }
  | { type: 'AUDIO_RESUME' }
  | { type: 'AUDIO_STOP' }
  | { type: 'SESSION_START'; captureIntervalSeconds: number; captureAudio?: boolean }
  | { type: 'SESSION_PAUSE' }
  | { type: 'SESSION_RESUME' }
  | { type: 'SESSION_STOP' }
  | { type: 'CAPTURE_NOW' }
  | { type: 'CAPTURE_RETRY'; captureId: string }
  | { type: 'SET_CAPTURE_INTERVAL'; captureIntervalSeconds: number }
  | { type: 'CONTENT_GET_VIDEO_STATE' }
  | { type: 'CONTENT_SET_SESSION'; session: LearningSession | null }
  | { type: 'CONTENT_CAPTURE'; snapshot: VideoSnapshot }
  | { type: 'CONTENT_VIDEO_CHANGED' }
  | { type: 'DATA_UPDATED' }
  | { type: 'SEEK_VIDEO'; sessionId: string; timestampSeconds: number }

export interface ExtensionResponse {
  success: boolean
  error?: string
  session?: LearningSession | null
  video?: VideoSnapshot | null
  capture?: VideoCapture
  audioBase64?: string
}
