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

function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const remainingSeconds = seconds % 60
  const time = `${minutes.toString().padStart(hours > 0 ? 2 : 1, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
  return hours > 0 ? `${hours}:${time}` : time
}

function isWithinDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (tab?.id && tab.url && /^https?:\/\//i.test(tab.url)) return tab
  const [currentWinTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (currentWinTab?.id && currentWinTab.url && /^https?:\/\//i.test(currentWinTab.url)) return currentWinTab
  const allTabs = await chrome.tabs.query({ active: true })
  return allTabs.find((t) => t.url && /^https?:\/\//i.test(t.url)) ?? tab ?? currentWinTab
}

async function activeVideoTab(): Promise<chrome.tabs.Tab> {
  const tab = await getActiveTab()
  if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    throw new Error('Open an http or https course page before starting a learning session.')
  }
  return tab
}


async function ensureContentScriptInTab(tabId: number): Promise<void> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window as unknown as Record<string, unknown>).__aiNotesVersion === '1.2.0',
    }).catch(() => [])

    if (results?.[0]?.result) {
      return
    }

    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js'],
    })
  } catch (error) {
    console.warn('Could not inject content script across all frames:', error)
  }
}

async function connectPage(tab: chrome.tabs.Tab): Promise<void> {
  if (!tab.id) throw new Error('The active browser tab is unavailable.')
  await ensureContentScriptInTab(tab.id)
}

function parseCourseTitleFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    const referrer = url.searchParams.get('referrer')
    const targetUrl = referrer ? new URL(referrer) : url
    const segments = targetUrl.pathname.split('/').filter(Boolean)
    const courseSlug = segments.find(
      (s) => s.includes('-') && !/^[0-9a-f-]{15,}$/i.test(s) && !/^[A-Z0-9]{8,}$/i.test(s),
    )
    if (courseSlug) {
      return courseSlug
        .split('-')
        .map((word) => {
          const lower = word.toLowerCase()
          if (['aws', 'ec2', 'iam', 's3', 'rds', 'vpc', 'api', 'cli', 'sdk', 'sns', 'sqs'].includes(lower)) {
            return lower.toUpperCase()
          }
          return word.charAt(0).toUpperCase() + word.slice(1)
        })
        .join(' ')
    }
  } catch {}
  return null
}

function isDisallowedTitle(text: string): boolean {
  if (!text || text.length < 3) return true
  const lower = text.toLowerCase().trim()
  return (
    lower === 'untitled video' ||
    lower === 'course video' ||
    lower === 'player' ||
    lower === 'video' ||
    lower === 'content' ||
    lower === 'index' ||
    lower === 'default' ||
    lower === 'levitate' ||
    lower === 'levitate learning experience' ||
    lower.startsWith('levitate learning') ||
    lower.includes("you're leaving") ||
    lower.includes('cookie') ||
    lower.includes('sign in')
  )
}

async function readTabVideo(tabId: number): Promise<VideoSnapshot> {
  await ensureContentScriptInTab(tabId)

  const tab = await chrome.tabs.get(tabId)

  let bestSnapshot: VideoSnapshot | null = null

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const reader = (window as unknown as Record<string, unknown>).__aiNotesReadSnapshot
        if (typeof reader === 'function') {
          return (reader as (inc?: boolean) => VideoSnapshot | null)(true)
        }
        function getAllVideos(root: Document | ShadowRoot | Element = document): HTMLVideoElement[] {
          const list: HTMLVideoElement[] = []
          try { list.push(...Array.from(root.querySelectorAll('video'))) } catch {}
          try {
            const all = root.querySelectorAll('*')
            for (let i = 0; i < all.length; i++) {
              const shadow = all[i].shadowRoot
              if (shadow) list.push(...getAllVideos(shadow))
            }
          } catch {}
          return list
        }
        const vids = getAllVideos()
        if (vids.length === 0) return null
        const video = vids.length === 1 ? vids[0] : vids.sort((a, b) => Number(!b.paused) - Number(!a.paused) || (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0]
        if (!video) return null
        const isAd = Boolean(
          document.querySelector('#movie_player.ad-showing, .html5-video-player.ad-showing, .ad-showing, .ad-interrupting')
          || (document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button') as HTMLElement | null)?.offsetParent !== null,
        )
        return {
          videoId: location.href,
          videoUrl: location.href,
          videoTitle: document.title || 'Course Video',
          timestampSeconds: Math.floor(video.currentTime),
          durationSeconds: Number.isFinite(video.duration) ? Math.floor(video.duration) : 0,
          isPlaying: !video.paused && !video.ended,
          transcriptText: '',
          platformName: location.hostname.includes('oracle') ? 'Oracle University' : location.hostname.includes('skillbuilder.aws') ? 'AWS Skill Builder' : location.hostname,
          isAd,
        }
      },
    })

    let anyFrameIsAd = false
    for (const item of results) {
      const snap = item.result as VideoSnapshot | null
      if (snap?.isAd) {
        anyFrameIsAd = true
      }
      if (snap && snap.videoId) {
        if (!bestSnapshot || item.frameId === 0 || (snap.isPlaying && !bestSnapshot.isPlaying)) {
          bestSnapshot = snap
        }
      }
    }
    if (bestSnapshot && anyFrameIsAd) {
      bestSnapshot.isAd = true
    }
  } catch (error) {
    console.warn('Script execution for video search failed:', error)
  }

  if (!bestSnapshot) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_GET_VIDEO_STATE' } satisfies ExtensionMessage) as ExtensionResponse
      if (response?.success && response.video) {
        bestSnapshot = response.video
      }
    } catch {}
  }

  if (bestSnapshot) {
    const courseFromUrl = tab.url ? parseCourseTitleFromUrl(tab.url) : null
    const isGenericTitle = isDisallowedTitle(bestSnapshot.videoTitle)

    if (isGenericTitle && tab.title) {
      const cleanTabTitle = tab.title
        .replace(/\s*-\s*YouTube\s*$/i, '')
        .replace(/\s*-\s*Oracle\s*University\s*$/i, '')
        .replace(/\s*\|\s*Oracle\s*.*$/i, '')
        .replace(/\s*-\s*Coursera\s*$/i, '')
        .trim()
      if (!isDisallowedTitle(cleanTabTitle)) {
        bestSnapshot.videoTitle = cleanTabTitle
      }
    }

    if (isDisallowedTitle(bestSnapshot.videoTitle) && courseFromUrl) {
      bestSnapshot.videoTitle = courseFromUrl
    }

    if (tab.url) {
      try {
        const snapUrl = new URL(bestSnapshot.videoUrl)
        const tabUrl = new URL(tab.url)
        if (snapUrl.origin !== tabUrl.origin || !bestSnapshot.videoUrl.includes(tabUrl.pathname)) {
          bestSnapshot.videoUrl = tab.url
        }
      } catch {}
      if (tab.url.includes('oracle')) {
        bestSnapshot.platformName = 'Oracle University'
      } else if (tab.url.includes('skillbuilder.aws')) {
        bestSnapshot.platformName = 'AWS Skill Builder'
        if (isDisallowedTitle(bestSnapshot.videoTitle) || bestSnapshot.videoTitle.endsWith('.mp4') || /^[0-9a-f-]{15,}/i.test(bestSnapshot.videoTitle)) {
          bestSnapshot.videoTitle = courseFromUrl || 'AWS Skill Builder Course'
        }
      }
    }
    return bestSnapshot
  }

  throw new Error('No playable web video was found in this tab. If the video just loaded, make sure it has started playing.')
}

async function updateContentSession(tabId: number, session: LearningSession | null): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (sess) => {
        const setter = (window as unknown as Record<string, unknown>).__aiNotesSetSession
        if (typeof setter === 'function') {
          setter(sess)
        }
      },
      args: [session],
    })
  } catch {}

  try {
    await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_SET_SESSION', session } satisfies ExtensionMessage)
  } catch {}
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
    getActiveTab(),
  ])

  if (!tab?.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    return { success: true, session: session ?? null, video: null }
  }

  try {
    await ensureContentScriptInTab(tab.id)
    const video = await readTabVideo(tab.id)
    return { success: true, session: session ?? null, video }
  } catch {
    return { success: true, session: session ?? null, video: null }
  }
}

async function startSession(
  captureIntervalSeconds: number,
  captureAudio: boolean,
  groupId?: string | null,
): Promise<ExtensionResponse> {
  if (!CAPTURE_INTERVALS.includes(captureIntervalSeconds)) {
    throw new Error('Choose a capture interval of 15, 30, 60, or 120 seconds.')
  }

  const tab = await activeVideoTab()
  const video = await readTabVideo(tab.id!)

  const existing = await activeSession()
  if (existing) {
    await updateActiveSession('completed')
  }

  const audioStreamId = captureAudio
    ? await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id })
    : undefined
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
    groupId: groupId ?? null,
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

  try {
    await takeCapture(tab.id!, video, true)
  } catch (error) {
    console.warn('Initial capture could not be taken immediately:', error)
  }

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

async function reopenSession(sessionId: string): Promise<ExtensionResponse> {
  const target = await getSession(sessionId)
  if (!target) throw new Error('The note session could not be found.')

  const current = await activeSession()
  if (current && current.id !== target.id) {
    const paused = { ...current, status: 'paused' as const }
    await saveSession(paused)
    await updateContentSession(current.tabId, null)
  }

  const tabs = await chrome.tabs.query({})
  let targetTab = tabs.find((t) => t.id === target.tabId && t.url && !t.url.startsWith('chrome'))
  if (!targetTab && target.videoId) {
    targetTab = tabs.find((t) => t.url && (t.url.includes(target.videoId) || (target.videoUrl && t.url === target.videoUrl)))
  }
  if (!targetTab) {
    targetTab = await getActiveTab()
  }

  const tabId = targetTab?.id ?? target.tabId

  const updated: LearningSession = {
    ...target,
    status: 'active',
    endedAt: undefined,
    tabId,
  }

  await saveSession(updated)
  if (tabId) {
    try {
      await ensureContentScriptInTab(tabId)
      await updateContentSession(tabId, updated)
    } catch {}
  }
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
    let diff = true
    try {
      const u1 = new URL(video.videoUrl)
      const u2 = new URL(session.videoUrl)
      const h1 = u1.hostname.toLowerCase()
      const h2 = u2.hostname.toLowerCase()
      if (h1.includes('skillbuilder') || h2.includes('skillbuilder')) diff = false
      else if (h1.includes('oracle') || h2.includes('oracle')) diff = false
      else if (h1.includes('coursera') || h2.includes('coursera')) diff = false
      else if (u1.origin === u2.origin) diff = false
    } catch {
      diff = false
    }
    if (diff) {
      throw new Error('That session’s video is no longer open in its original tab.')
    }
  }
  await chrome.tabs.update(session.tabId, { active: true })
  try {
    await chrome.scripting.executeScript({
      target: { tabId: session.tabId, allFrames: true },
      func: (time) => {
        const seeker = (window as unknown as Record<string, unknown>).__aiNotesSeek
        if (typeof seeker === 'function') {
          return seeker(time)
        }
        return false
      },
      args: [timestampSeconds],
    })
  } catch {}
  try {
    await chrome.tabs.sendMessage(
      session.tabId,
      { type: 'SEEK_VIDEO', sessionId, timestampSeconds } satisfies ExtensionMessage,
    )
  } catch {}
  return { success: true }
}

async function processCapture(capture: VideoCapture, session: LearningSession): Promise<void> {
  const cleanTranscript = capture.transcriptText.trim()
  if (!cleanTranscript) {
    await saveCapture({ ...capture, processingStatus: 'skipped' })
    sendUpdated()
    return
  }

  if (!capture.isManual) {
    try {
      const existing = await listCaptures(session.id)
      const completedCaptures = [...existing]
        .filter((c) => c.id !== capture.id && c.processingStatus === 'completed' && c.transcriptText.trim())
        .sort((a, b) => b.capturedAt - a.capturedAt)
      const lastCompleted = completedCaptures[0]

      if (lastCompleted) {
        // Exact transcript match — definitely a duplicate
        if (lastCompleted.transcriptText.trim() === cleanTranscript) {
          await saveCapture({ ...capture, processingStatus: 'skipped' })
          sendUpdated()
          return
        }
        // Fallback synthetic prompts with very close timestamps mean the same slide is still showing
        const isSyntheticFallback = cleanTranscript.startsWith('[Visual slide at ') || cleanTranscript.startsWith('Key concepts and technical details') || cleanTranscript.startsWith('Lecture topic and key concepts')
        const lastIsSyntheticFallback = lastCompleted.transcriptText.trim().startsWith('[Visual slide at ') || lastCompleted.transcriptText.trim().startsWith('Key concepts and technical details') || lastCompleted.transcriptText.trim().startsWith('Lecture topic and key concepts')
        const timestampDiff = Math.abs(capture.timestampSeconds - lastCompleted.timestampSeconds)
        if (isSyntheticFallback && lastIsSyntheticFallback && timestampDiff < 30) {
          await saveCapture({ ...capture, processingStatus: 'skipped' })
          sendUpdated()
          return
        }
      }
    } catch (error) {
      console.warn('Could not check previous captures for deduplication.', error)
    }
  }

  await saveCapture({ ...capture, processingStatus: 'processing' })
  sendUpdated()

  try {
    const settings = await chrome.storage.local.get(['aiProvider', 'aiModel'])
    const provider = typeof settings.aiProvider === 'string' ? settings.aiProvider as AiProvider : 'GEMINI'
    const model = typeof settings.aiModel === 'string' && settings.aiModel.trim()
      ? settings.aiModel.trim()
      : (provider === 'GEMINI' ? 'models/gemini-2.5-flash' : 'gpt-4.1-mini')
    const note = await generateNote({
      provider,
      model,
      videoTitle: session.videoTitle,
      videoUrl: session.videoUrl,
      timestampSeconds: capture.timestampSeconds,
      transcriptText: capture.transcriptText,
      ...(capture.screenshotDataUrl
        ? { screenshotBase64: capture.screenshotDataUrl.slice(capture.screenshotDataUrl.indexOf(',') + 1) }
        : {}),
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
  targetSession?: LearningSession,
  isManual = false,
): Promise<ExtensionResponse> {
  const session = targetSession ?? await activeSession()
  if (!session || (session.status !== 'active' && !allowPaused)) {
    throw new Error('Start or resume a learning session before capturing.')
  }
  if (session.tabId !== tabId) {
    throw new Error('The active session belongs to a different video tab.')
  }

  const video = snapshot ?? await readTabVideo(tabId)

  // Ignore captures if an ad is actively playing
  if (video.isAd) {
    if (!allowPaused) {
      return { success: true }
    }
    throw new Error('An advertisement is currently playing. Capturing is paused until the lecture resumes.')
  }

  // Automatic captures must only run when the video is actively playing
  if (!allowPaused && !video.isPlaying) {
    return { success: true }
  }

  // Strict interval gatekeeper: enforce user's captureIntervalSeconds
  const existingCaptures = await listCaptures(session.id)
  if (existingCaptures.length > 0 && !allowPaused) {
    const lastCapture = existingCaptures.reduce((prev, curr) => (curr.capturedAt > prev.capturedAt ? curr : prev))
    const timeSinceLastCaptureSec = (Date.now() - lastCapture.capturedAt) / 1000
    const videoSecondsAdvanced = Math.abs(video.timestampSeconds - lastCapture.timestampSeconds)
    const minThreshold = Math.max(10, session.captureIntervalSeconds - 4)

    if (timeSinceLastCaptureSec < minThreshold || videoSecondsAdvanced < minThreshold) {
      return { success: true }
    }
  }

  if (video.videoId !== session.videoId) {
    let trulyDifferent = true
    try {
      const u1 = new URL(video.videoUrl)
      const u2 = new URL(session.videoUrl)
      const h1 = u1.hostname.toLowerCase()
      const h2 = u2.hostname.toLowerCase()

      if (h1.includes('skillbuilder') || h2.includes('skillbuilder')) trulyDifferent = false
      else if (h1.includes('oracle') || h2.includes('oracle')) trulyDifferent = false
      else if (h1.includes('coursera') || h2.includes('coursera')) trulyDifferent = false
      else if (isWithinDomain(h1, 'youtube.com') && isWithinDomain(h2, 'youtube.com')) {
        trulyDifferent = u1.searchParams.get('v') !== u2.searchParams.get('v')
      } else if (u1.origin === u2.origin) {
        trulyDifferent = false
      }
    } catch {
      trulyDifferent = false
    }
    if (trulyDifferent) {
      const pausedSession = { ...session, status: 'paused' as const }
      if (session.captureAudio) await sendAudioMessage({ type: 'AUDIO_PAUSE' })
      await saveSession(pausedSession)
      await updateContentSession(tabId, null)
      sendUpdated()
      throw new Error('The video changed. This session was paused so captures from different videos are not mixed.')
    }
  }
  let screenshotDataUrl: string | undefined = snapshot?.screenshotDataUrl ?? video.screenshotDataUrl
  let screenshotError: string | undefined

  if (!screenshotDataUrl) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const direct = (window as unknown as Record<string, unknown>).__aiNotesCaptureFrame
          if (typeof direct === 'function') {
            const frame = (direct as () => string | undefined)()
            if (frame) return frame
          }
          function getAllVideos(root: Document | ShadowRoot | Element = document): HTMLVideoElement[] {
            const list: HTMLVideoElement[] = []
            try { list.push(...Array.from(root.querySelectorAll('video'))) } catch {}
            try {
              const all = root.querySelectorAll('*')
              for (let i = 0; i < all.length; i++) {
                const shadow = all[i].shadowRoot
                if (shadow) list.push(...getAllVideos(shadow))
              }
            } catch {}
            return list
          }
          const vids = getAllVideos()
          const video = vids.find((v) => !v.paused && v.videoWidth > 0) ?? vids.find((v) => v.videoWidth > 0)
          if (!video || !video.videoWidth || !video.videoHeight) return null
          try {
            const canvas = document.createElement('canvas')
            const maxDim = 1280
            const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight))
            canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
            canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
            const ctx = canvas.getContext('2d')
            if (!ctx) return null
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            return canvas.toDataURL('image/jpeg', 0.8)
          } catch {
            return null
          }
        },
      })
      for (const item of results) {
        if (typeof item.result === 'string' && item.result.startsWith('data:image/')) {
          screenshotDataUrl = item.result
          break
        }
      }
    } catch (error) {
      console.warn('Direct canvas frame extraction failed:', error)
    }
  }

  if (!screenshotDataUrl) {
    try {
      const tab = await chrome.tabs.get(tabId)
      const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId })
      if (activeTab?.id === tabId) {
        screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: 'jpeg',
          quality: 75,
        })
      } else {
        screenshotError = 'The video tab is in the background and video frame could not be drawn to canvas.'
      }
    } catch (error) {
      screenshotError = errorMessage(error)
    }
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

  if (!transcriptText.trim()) {
    const formattedTime = formatTimestamp(video.timestampSeconds)
    transcriptText = screenshotDataUrl
      ? `[Visual slide at ${formattedTime}] Read and analyze the text, diagrams, bullet points, and code visible on this slide.`
      : `Key concepts and technical details explained at ${formattedTime} in "${session.videoTitle}".`
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
    processingStatus: 'pending',
    ...(isManual ? { isManual: true } : {}),
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
      return startSession(message.captureIntervalSeconds, message.captureAudio ?? false, message.groupId)
    case 'SESSION_PAUSE':
      return updateActiveSession('paused')
    case 'SESSION_RESUME':
      return updateActiveSession('active')
    case 'SESSION_STOP':
      return updateActiveSession('completed')
    case 'SESSION_REOPEN':
      return reopenSession(message.sessionId)
    case 'SET_CAPTURE_INTERVAL':
      return updateCaptureInterval(message.captureIntervalSeconds)
    case 'SET_PROVIDER_PREFERENCES': {
      const model = message.model.trim()
      if (!model) throw new Error('Enter a model ID before saving.')
      await chrome.storage.local.set({ aiProvider: message.provider, aiModel: model })
      const saved = await chrome.storage.local.get(['aiProvider', 'aiModel'])
      if (saved.aiProvider !== message.provider || saved.aiModel !== model) {
        throw new Error('The model preference could not be saved.')
      }
      sendUpdated()
      return { success: true }
    }
    case 'SEEK_VIDEO':
      return seekVideo(message.sessionId, message.timestampSeconds)
    case 'CAPTURE_NOW': {
      let session = message.sessionId ? await getSession(message.sessionId) : await activeSession()
      if (!session) session = await activeSession()
      if (!session) throw new Error('Start or continue a learning session before capturing.')
      if (session.status === 'completed') {
        await reopenSession(session.id)
        session = (await getSession(session.id)) ?? session
      }
      return takeCapture(session.tabId, undefined, true, session, true)
    }
    case 'CAPTURE_RETRY':
      return retryCapture(message.captureId)
    case 'CONTENT_CAPTURE':
      if (!sender.tab?.id) throw new Error('The capture did not come from a video tab.')
      return takeCapture(sender.tab.id, message.snapshot)
    case 'CONTENT_VIDEO_CHANGED':
      if (!sender.tab?.id) throw new Error('The video change did not come from a video tab.')
      return pauseSessionForVideoChange(sender.tab.id)
    case 'BACKEND_FETCH': {
      const { path, init } = message
      const urls = ['http://127.0.0.1:8080', 'http://localhost:8080']
      let lastErr: unknown
      for (const baseUrl of urls) {
        try {
          const res = await fetch(`${baseUrl}${path}`, init ? {
            method: init.method,
            headers: init.headers,
            body: init.body,
          } : undefined)
          if (!res.ok) {
            return { success: false, error: `The notes service returned HTTP ${res.status}.` }
          }
          if (res.status === 204) return { success: true, data: undefined }
          const data = await res.json()
          return { success: true, data }
        } catch (e) {
          lastErr = e
        }
      }
      return { success: false, error: errorMessage(lastErr) }
    }
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

chrome.tabs.onActivated.addListener(() => {
  sendUpdated()
})

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    sendUpdated()
  }
})

let sessionTicker: ReturnType<typeof setInterval> | null = null

function ensureSessionTicker() {
  if (sessionTicker !== null) return
  sessionTicker = setInterval(() => {
    void (async () => {
      try {
        const session = await activeSession()
        if (!session || session.status !== 'active') return

        const video = await readTabVideo(session.tabId).catch(() => null)
        if (!video || !video.isPlaying || video.isAd) return

        const existingCaptures = await listCaptures(session.id)
        if (existingCaptures.length === 0) {
          await takeCapture(session.tabId, video, true)
          return
        }

        const lastCapture = existingCaptures.reduce((prev, curr) => (curr.capturedAt > prev.capturedAt ? curr : prev))
        const timeSinceSec = (Date.now() - lastCapture.capturedAt) / 1000
        const videoAdvanceSec = Math.abs(video.timestampSeconds - lastCapture.timestampSeconds)
        const threshold = Math.max(10, session.captureIntervalSeconds - 2)

        if (timeSinceSec >= threshold && videoAdvanceSec >= threshold) {
          await takeCapture(session.tabId, video, false)
        }
      } catch (err) {
        console.warn('Session ticker error:', err)
      }
    })()
  }, 3000)
}

ensureSessionTicker()

