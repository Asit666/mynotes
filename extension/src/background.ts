import { generateNote, toLocalNote, transcribeAudio } from './api'
import type { AiProvider } from './api'
import type {
  ExtensionMessage,
  ExtensionResponse,
  LearningSession,
  VideoCapture,
  VideoSnapshot,
} from './models'
import { getSession, listCaptures, listSessions, saveCapture, saveNote, saveSession } from './storage'

const CAPTURE_INTERVALS = [15, 30, 60, 120]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The extension could not complete that action.'
}

function sendUpdated(): void {
  void chrome.runtime.sendMessage({ type: 'DATA_UPDATED' } satisfies ExtensionMessage)
    .catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.includes('Receiving end does not exist')) {
        console.error('Could not refresh the extension UI.', error)
      }
    })
}

async function activeVideoTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    throw new Error('Open an http or https course page before starting a learning session.')
  }
  return tab
}

function originPattern(tab: chrome.tabs.Tab): string {
  if (!tab.url) throw new Error('The active page address is unavailable.')
  const url = new URL(tab.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Video capture is only available on http and https pages.')
  }
  return `${url.origin}/*`
}

async function connectPage(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) throw new Error('The active browser tab is unavailable.')
  if (!await chrome.permissions.contains({ origins: [originPattern(tab)] })) {
    throw new Error('Allow this site when prompted so the extension can read its video player and available captions.')
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'CONTENT_GET_VIDEO_STATE' } satisfies ExtensionMessage)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Receiving end does not exist')) throw error
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
  }
}

async function readTabVideo(tabId: number): Promise<VideoSnapshot> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_GET_VIDEO_STATE' } satisfies ExtensionMessage) as ExtensionResponse
    if (!response.success || !response.video) {
      throw new Error(response.error ?? 'No playable web video was found in this tab.')
    }
    return response.video
  } catch (error) {
    if (error instanceof Error && error.message.includes('Receiving end does not exist')) {
      const tab = await chrome.tabs.get(tabId)
      await connectPage(tab)
      return readTabVideo(tabId)
    }
    throw error
  }
}

async function updateContentSession(tabId: number, session: LearningSession | null): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_SET_SESSION', session } satisfies ExtensionMessage)
}

async function ensureOffscreenDocument(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Capture short audio segments only when the user enables audio transcription for a study session.',
    })
  }
}

async function sendAudioMessage(message: ExtensionMessage): Promise<ExtensionResponse> {
  const response = await chrome.runtime.sendMessage<ExtensionMessage, ExtensionResponse>(message)
  if (!response?.success) throw new Error(response?.error ?? 'The audio recorder could not complete that action.')
  return response
}

async function stopAudioCapture(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
  if (contexts.length === 0) return
  await sendAudioMessage({ type: 'AUDIO_STOP' })
  await chrome.offscreen.closeDocument()
}

async function activeSession(): Promise<LearningSession | undefined> {
  const sessions = await listSessions()
  return sessions.find((session) => session.status === 'active' || session.status === 'paused')
}

async function getUiState(): Promise<ExtensionResponse> {
  const [session, tab] = await Promise.all([
    activeSession(),
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([activeTab]) => activeTab),
  ])

  if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    return { success: true, session: session ?? null, video: null }
  }

  try {
    if (!await chrome.permissions.contains({ origins: [originPattern(tab)] })) {
      return { success: true, session: session ?? null, video: null }
    }
    const video = await readTabVideo(tab.id)
    return { success: true, session: session ?? null, video }
  } catch (error) {
    return { success: false, error: errorMessage(error), session: session ?? null, video: null }
  }
}

async function startSession(
  captureIntervalSeconds: number,
  captureAudio: boolean,
): Promise<ExtensionResponse> {
  if (!CAPTURE_INTERVALS.includes(captureIntervalSeconds)) {
    throw new Error('Choose a capture interval of 15, 30, 60, or 120 seconds.')
  }
  if (await activeSession()) {
    throw new Error('Finish or pause the current session before starting another video.')
  }

  const tab = await activeVideoTab()
  const audioStreamId = captureAudio
    ? await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id })
    : undefined
  const video = await readTabVideo(tab.id!)
  const session: LearningSession = {
    id: crypto.randomUUID(),
    videoId: video.videoId,
    videoUrl: video.videoUrl,
    videoTitle: video.videoTitle,
    platformName: video.platformName,
    tabId: tab.id!,
    startedAt: Date.now(),
    captureIntervalSeconds,
    captureAudio,
    status: 'active',
  }

  if (captureAudio && !audioStreamId) {
    throw new Error('The browser did not provide an audio stream. Reconnect the page and try again.')
  }
  if (captureAudio) await ensureOffscreenDocument()
  try {
    if (captureAudio && audioStreamId) {
      await sendAudioMessage({ type: 'AUDIO_START', streamId: audioStreamId })
    }
    await saveSession(session)
    await updateContentSession(tab.id!, session)
  } catch (error) {
    if (captureAudio) await stopAudioCapture()
    throw error
  }
  sendUpdated()
  return { success: true, session, video }
}

async function updateActiveSession(status: LearningSession['status']): Promise<ExtensionResponse> {
  const session = await activeSession()
  if (!session) throw new Error('There is no active learning session.')

  if (status === 'active') {
    const video = await readTabVideo(session.tabId)
    if (video.videoId !== session.videoId) {
      throw new Error('This session belongs to another video. Finish it and start a new session for the current video.')
    }
  }
  if (session.captureAudio) {
    if (status === 'paused') await sendAudioMessage({ type: 'AUDIO_PAUSE' })
    if (status === 'active') await sendAudioMessage({ type: 'AUDIO_RESUME' })
    if (status === 'completed') await stopAudioCapture()
  }
  const updated: LearningSession = {
    ...session,
    status,
    ...(status === 'completed' ? { endedAt: Date.now() } : {}),
  }
  await saveSession(updated)
  await updateContentSession(updated.tabId, status === 'completed' ? null : updated)
  sendUpdated()
  return { success: true, session: updated }
}

async function updateCaptureInterval(captureIntervalSeconds: number): Promise<ExtensionResponse> {
  if (!CAPTURE_INTERVALS.includes(captureIntervalSeconds)) {
    throw new Error('Choose a capture interval of 15, 30, 60, or 120 seconds.')
  }

  const session = await activeSession()
  if (!session) throw new Error('Start a learning session before changing its capture interval.')
  const updated = { ...session, captureIntervalSeconds }
  await saveSession(updated)
  await updateContentSession(updated.tabId, updated)
  sendUpdated()
  return { success: true, session: updated }
}

async function seekVideo(sessionId: string, timestampSeconds: number): Promise<ExtensionResponse> {
  if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0) {
    throw new Error('Choose a valid video timestamp.')
  }
  const session = await getSession(sessionId)
  if (!session) throw new Error('The learning session could not be found.')
  const video = await readTabVideo(session.tabId)
  if (video.videoId !== session.videoId) {
    throw new Error('That session’s video is no longer open in its original tab.')
  }
  await chrome.tabs.update(session.tabId, { active: true })
  await chrome.tabs.sendMessage(
    session.tabId,
    { type: 'SEEK_VIDEO', sessionId, timestampSeconds } satisfies ExtensionMessage,
  )
  return { success: true }
}

async function processCapture(capture: VideoCapture, session: LearningSession): Promise<void> {
  if (!capture.transcriptText.trim()) {
    await saveCapture({ ...capture, processingStatus: 'skipped' })
    sendUpdated()
    return
  }

  await saveCapture({ ...capture, processingStatus: 'processing' })
  sendUpdated()

  try {
    const settings = await chrome.storage.local.get(['aiProvider', 'aiModel'])
    const provider = typeof settings.aiProvider === 'string' ? settings.aiProvider as AiProvider : 'OPENAI'
    const model = typeof settings.aiModel === 'string' && settings.aiModel.trim()
      ? settings.aiModel.trim()
      : 'gpt-4.1-mini'
    const note = await generateNote({
      provider,
      model,
      videoTitle: session.videoTitle,
      videoUrl: session.videoUrl,
      timestampSeconds: capture.timestampSeconds,
      transcriptText: capture.transcriptText,
    })
    await saveNote(toLocalNote(note, session.id, capture.id))
    await saveCapture({ ...capture, processingStatus: 'completed' })
  } catch (error) {
    await saveCapture({
      ...capture,
      processingStatus: 'failed',
      processingError: errorMessage(error),
    })
  }

  sendUpdated()
}

async function takeCapture(
  tabId: number,
  snapshot?: VideoSnapshot,
  allowPaused = false,
): Promise<ExtensionResponse> {
  const session = await activeSession()
  if (!session || (session.status !== 'active' && !allowPaused)) {
    throw new Error('Start or resume a learning session before capturing.')
  }
  if (session.tabId !== tabId) {
    throw new Error('The active session belongs to a different video tab.')
  }

  const video = snapshot ?? await readTabVideo(tabId)
  if (video.videoId !== session.videoId) {
    const pausedSession = { ...session, status: 'paused' as const }
    if (session.captureAudio) await sendAudioMessage({ type: 'AUDIO_PAUSE' })
    await saveSession(pausedSession)
    await updateContentSession(tabId, null)
    sendUpdated()
    throw new Error('The video changed. This session was paused so captures from different videos are not mixed.')
  }
  let screenshotDataUrl: string | undefined
  let screenshotError: string | undefined

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, windowId: (await chrome.tabs.get(tabId)).windowId })
    if (activeTab?.id !== tabId) {
      throw new Error('Switch to the video tab to capture its screenshot.')
    }
    screenshotDataUrl = await chrome.tabs.captureVisibleTab(activeTab.windowId, {
      format: 'jpeg',
      quality: 70,
    })
  } catch (error) {
    screenshotError = errorMessage(error)
  }

  let transcriptText = video.transcriptText
  let audioBase64: string | undefined
  let transcriptionError: string | undefined
  if (session.captureAudio && session.status === 'active') {
    try {
      const audio = await sendAudioMessage({ type: 'AUDIO_FLUSH' })
      audioBase64 = audio.audioBase64
      if (!transcriptText.trim()) {
        if (!audioBase64) throw new Error('No audio was captured for this interval. Try again while the video is playing.')
        transcriptText = await transcribeAudio(audioBase64)
        if (!transcriptText.trim()) throw new Error('No speech was recognized in this audio segment.')
        audioBase64 = undefined
      }
    } catch (error) {
      transcriptionError = errorMessage(error)
    }
  }

  const capture: VideoCapture = {
    id: crypto.randomUUID(),
    sessionId: session.id,
    timestampSeconds: video.timestampSeconds,
    capturedAt: Date.now(),
    transcriptText,
    ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
    ...(screenshotError ? { screenshotError } : {}),
    ...(audioBase64 && transcriptionError ? { audioBase64 } : {}),
    ...(transcriptionError ? { processingError: transcriptionError } : {}),
    processingStatus: transcriptText.trim() ? 'pending' : transcriptionError ? 'failed' : 'skipped',
  }

  await saveCapture(capture)
  sendUpdated()
  if (transcriptText.trim()) {
    void processCapture(capture, session).catch((error: unknown) => {
      console.error('Could not finish processing a saved capture.', error)
    })
  }
  return { success: true, capture }
}

async function retryCapture(captureId: string): Promise<ExtensionResponse> {
  const sessions = await listSessions()
  for (const session of sessions) {
    const capture = (await listCaptures(session.id)).find((item) => item.id === captureId)
    if (capture) {
      if (capture.processingStatus !== 'failed') {
        throw new Error('Only failed captures can be retried.')
      }
      let retry = capture
      if (!retry.transcriptText.trim() && retry.audioBase64) {
        const transcriptText = await transcribeAudio(retry.audioBase64)
        if (!transcriptText.trim()) throw new Error('No speech was recognized in this audio segment.')
        const withoutAudio = { ...retry }
        delete withoutAudio.audioBase64
        retry = { ...withoutAudio, transcriptText, processingStatus: 'pending', processingError: undefined }
        await saveCapture(retry)
      }
      await processCapture(retry, session)
      return { success: true, capture: retry }
    }
  }
  throw new Error('The capture could not be found.')
}

async function pauseSessionForVideoChange(tabId: number): Promise<ExtensionResponse> {
  const session = await activeSession()
  if (!session || session.tabId !== tabId) return { success: true }
  if (session.captureAudio) await sendAudioMessage({ type: 'AUDIO_PAUSE' })
  const paused = { ...session, status: 'paused' as const }
  await saveSession(paused)
  await updateContentSession(tabId, null)
  sendUpdated()
  return { success: true, session: paused }
}

async function handleMessage(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<ExtensionResponse> {
  switch (message.type) {
    case 'UI_GET_STATE':
      return getUiState()
    case 'PAGE_CONNECT': {
      const tab = await activeVideoTab()
      await connectPage(tab)
      return { success: true, video: await readTabVideo(tab.id!) }
    }
    case 'SESSION_START':
      return startSession(message.captureIntervalSeconds, message.captureAudio ?? false)
    case 'SESSION_PAUSE':
      return updateActiveSession('paused')
    case 'SESSION_RESUME':
      return updateActiveSession('active')
    case 'SESSION_STOP':
      return updateActiveSession('completed')
    case 'SET_CAPTURE_INTERVAL':
      return updateCaptureInterval(message.captureIntervalSeconds)
    case 'SEEK_VIDEO':
      return seekVideo(message.sessionId, message.timestampSeconds)
    case 'CAPTURE_NOW': {
      const session = await activeSession()
      if (!session) throw new Error('Start a learning session before capturing.')
      return takeCapture(session.tabId, undefined, true)
    }
    case 'CAPTURE_RETRY':
      return retryCapture(message.captureId)
    case 'CONTENT_CAPTURE':
      if (!sender.tab?.id) throw new Error('The capture did not come from a video tab.')
      return takeCapture(sender.tab.id, message.snapshot)
    case 'CONTENT_VIDEO_CHANGED':
      if (!sender.tab?.id) throw new Error('The video change did not come from a video tab.')
      return pauseSessionForVideoChange(sender.tab.id)
    default:
      throw new Error('This extension message is not supported here.')
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
})

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type.startsWith('AUDIO_')) return false
  void handleMessage(message, sender)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({ success: false, error: errorMessage(error) } satisfies ExtensionResponse)
    })
  return true
})

chrome.runtime.onStartup.addListener(() => {
  void listSessions().then((sessions) => Promise.all(
    sessions
      .filter((session) => session.status === 'active')
      .map(async (session) => {
        const stored = await getSession(session.id)
        if (stored?.status === 'active') {
          await saveSession({ ...stored, status: 'paused' })
        }
      }),
  )).catch((error: unknown) => {
    console.error('Could not restore session state after browser startup.', error)
  })

  chrome.tabs.onRemoved.addListener((tabId) => {
    void activeSession().then(async (session) => {
      if (!session || session.tabId !== tabId) return
      if (session.captureAudio) await stopAudioCapture()
      await saveSession({ ...session, status: 'paused' })
      sendUpdated()
    }).catch((error: unknown) => {
      console.error('Could not pause the session after its video tab closed.', error)
    })
  })
})
