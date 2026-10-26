import type { ExtensionMessage, LearningSession, VideoSnapshot } from './models'

const globalScope = window as unknown as Record<string, unknown>
if (typeof globalScope.__aiNotesCleanup === 'function') {
  try {
    (globalScope.__aiNotesCleanup as () => void)()
  } catch {}
}
globalScope.__aiNotesInjected = true

let currentSession: LearningSession | null = null
let nextCaptureAt = 0
let lastCapturedTimestamp = -1
let lastCapturedAtTime = 0
const captionBuffer: { timestampSeconds: number; text: string }[] = []

function isWithinDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function getAllVideosInTree(root: Document | ShadowRoot | Element = document): HTMLVideoElement[] {
  const vids: HTMLVideoElement[] = []
  try {
    const direct = root.querySelectorAll('video')
    for (let i = 0; i < direct.length; i++) {
      vids.push(direct[i])
    }
  } catch {}
  try {
    const all = root.querySelectorAll('*')
    for (let i = 0; i < all.length; i++) {
      const shadow = all[i].shadowRoot
      if (shadow) {
        vids.push(...getAllVideosInTree(shadow))
      }
    }
  } catch {}
  return vids
}

function findVideo(): HTMLVideoElement | null {
  const videos = getAllVideosInTree(document)
  if (videos.length === 0) return null
  if (videos.length === 1) return videos[0]
  const nonZero = videos.filter((v) => {
    const w = v.clientWidth || 0
    const h = v.clientHeight || 0
    return (w > 50 && h > 50) || !v.paused || Number(v.duration) > 0
  })
  const pool = nonZero.length > 0 ? nonZero : videos
  return pool.sort((left, right) => {
    const leftPlaying = Number(!left.paused && !left.ended)
    const rightPlaying = Number(!right.paused && !right.ended)
    const leftArea = (left.clientWidth || 300) * (left.clientHeight || 150)
    const rightArea = (right.clientWidth || 300) * (right.clientHeight || 150)
    return rightPlaying - leftPlaying
      || Number(right === document.activeElement) - Number(left === document.activeElement)
      || rightArea - leftArea
  })[0] ?? null
}

function parseTimestamp(value: string): number | undefined {
  const match = value.match(/\b(?:\d+:)?\d+:\d+\b/)
  if (!match) return undefined
  const parts = match[0].split(':').map(Number)
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) return undefined
  return parts.reduce((total, part) => total * 60 + part, 0)
}

const CAPTION_SELECTOR = [
  '.ytp-caption-segment',
  '.caption-window',
  '[class*="caption-window" i]',
  '.vjs-text-track-cue',
  '.vjs-text-track-display',
  '.jw-text-track-cue',
  '.jw-captions',
  '.bmpui-ui-subtitle-label',
  '.shaka-text-container span',
  '[class*="caption-text" i]',
  '[class*="captions-text" i]',
  '[class*="captions-display" i]',
  '[class*="subtitle-cue" i]',
  '[class*="subtitles-cue" i]',
  '[class*="subtitle-text" i]',
  '[class*="text-track-cue" i]',
  '[class*="player-caption" i]',
  '[class*="player-subtitle" i]',
  '[aria-live="polite"][class*="caption" i]',
  '[aria-live="polite"][class*="subtitle" i]',
  '[class*="caption" i]',
  '[class*="subtitle" i]',
  '[class*="cue" i]',
].join(', ')

function querySelectorAllDeep(selector: string, root: Document | ShadowRoot | Element = document): Element[] {
  const results: Element[] = []
  try {
    results.push(...Array.from(root.querySelectorAll(selector)))
  } catch {}
  try {
    const all = root.querySelectorAll('*')
    for (let i = 0; i < all.length; i++) {
      const shadow = all[i].shadowRoot
      if (shadow) {
        results.push(...querySelectorAllDeep(selector, shadow))
      }
    }
  } catch {}
  return results
}

function getOnScreenCaptionText(): string {
  const elements = querySelectorAllDeep(CAPTION_SELECTOR)
    .filter((el) => {
      if (el.getClientRects().length === 0) return false
      if (['BUTTON', 'SELECT', 'INPUT', 'NAV', 'HEADER'].includes(el.tagName)) return false
      if (el.closest('button, nav, .vjs-control-bar, .ytp-chrome-bottom, .jw-controls')) return false
      const text = el.textContent?.trim() ?? ''
      return text.length > 0 && text.length < 350
    })

  const leaves = elements.filter((el) => !elements.some((other) => other !== el && el.contains(other)))
  const parts = leaves.map((el) => el.textContent?.trim() ?? '').filter(Boolean)
  return [...new Set(parts)].join(' ').trim()
}

function getTrackCues(timestampSeconds: number): string[] {
  const cues: string[] = []
  for (const video of getAllVideosInTree(document)) {
    for (const track of Array.from(video.textTracks ?? [])) {
      if (track.mode === 'disabled') {
        try {
          track.mode = 'hidden'
        } catch {
          // ignore
        }
      }
      for (const cue of Array.from(track.cues ?? [])) {
        const text = cue instanceof VTTCue ? cue.text.trim() : ('text' in cue ? String((cue as { text?: unknown }).text ?? '').trim() : '')
        if (text && cue.startTime <= timestampSeconds + 30 && cue.endTime >= timestampSeconds - 30) {
          cues.push(text)
        }
      }
    }
  }
  return [...new Set(cues)]
}

function bufferCurrentCaptions(timestampSeconds: number): void {
  const current = getOnScreenCaptionText()
  if (current) {
    const last = captionBuffer.at(-1)
    if (!last || (last.text !== current && !last.text.endsWith(current))) {
      captionBuffer.push({ timestampSeconds, text: current })
    }
  }

  for (const video of getAllVideosInTree(document)) {
    for (const track of Array.from(video.textTracks ?? [])) {
      if (track.mode === 'disabled') {
        try { track.mode = 'hidden' } catch {}
      }
      for (const cue of Array.from(track.activeCues ?? [])) {
        const text = cue instanceof VTTCue ? cue.text.trim() : ('text' in cue ? String((cue as { text?: unknown }).text ?? '').trim() : '')
        if (text) {
          const last = captionBuffer.at(-1)
          if (!last || last.text !== text) {
            captionBuffer.push({ timestampSeconds, text })
          }
        }
      }
    }
  }

  const cutoff = timestampSeconds - 90
  while (captionBuffer.length > 0 && captionBuffer[0].timestampSeconds < cutoff) {
    captionBuffer.shift()
  }
}

function collectTranscript(timestampSeconds: number): string {
  const youtubeSegments = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'))
    .map((segment) => {
      const timestamp = segment.querySelector('.segment-start-offset, .segment-timestamp, [class*="start-offset" i], [class*="timestamp" i]')?.textContent ?? ''
      const text = segment.querySelector('.segment-text, yt-formatted-string, [class*="segment-text" i]')?.textContent?.trim() ?? ''
      return { timestampSeconds: parseTimestamp(timestamp), text }
    })
    .filter((segment) => segment.timestampSeconds !== undefined && segment.text.length > 0)
    .filter((segment) => Math.abs(segment.timestampSeconds! - timestampSeconds) <= 30)
    .map((segment) => segment.text)

  if (youtubeSegments.length > 0) return [...new Set(youtubeSegments)].join('\n')

  const buffered = captionBuffer
    .filter((item) => Math.abs(item.timestampSeconds - timestampSeconds) <= 35)
    .map((item) => item.text)

  if (buffered.length > 0) {
    const cleaned: string[] = []
    for (let i = 0; i < buffered.length; i++) {
      const curr = buffered[i]
      const next = buffered[i + 1]
      if (next && next.includes(curr)) continue
      cleaned.push(curr)
    }
    if (cleaned.length > 0) return cleaned.join('\n')
  }

  const onScreen = getOnScreenCaptionText()
  if (onScreen) return onScreen

  const trackCues = getTrackCues(timestampSeconds)
  if (trackCues.length > 0) return trackCues.join('\n')

  const visibleTranscript = Array.from(document.querySelectorAll(
    '[class*="transcript" i] [class*="segment" i], [class*="transcript" i] [class*="caption" i], [class*="subtitle" i]',
  ))
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => element.textContent?.trim() ?? '')
    .filter((text) => text.length > 0 && text.length < 2000)

  return [...new Set(visibleTranscript)].slice(-30).join('\n')
}

function captureVideoFrame(): string | undefined {
  const video = findVideo()
  if (!video || !video.videoWidth || !video.videoHeight) return undefined
  try {
    const canvas = document.createElement('canvas')
    const maxDim = 1280
    const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch {
    return undefined
  }
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

function isValidTitle(text: string): boolean {
  if (!text || text.length < 3 || text.length > 250) return false
  const lower = text.toLowerCase().trim()
  if (
    lower.includes("you're leaving") ||
    lower.includes('redirecting') ||
    lower.includes('cookie') ||
    lower.includes('sign in') ||
    lower.includes('privacy policy') ||
    lower.includes('terms of use')
  ) {
    return false
  }
  if (
    lower === 'levitate' ||
    lower === 'levitate learning experience' ||
    lower.startsWith('levitate learning') ||
    lower === 'course video' ||
    lower === 'untitled video' ||
    lower === 'video player' ||
    lower === 'player' ||
    lower === 'content'
  ) {
    return false
  }
  return true
}

function extractCleanTitle(): string {
  const fromUrl =
    parseCourseTitleFromUrl(location.href) ||
    (document.referrer ? parseCourseTitleFromUrl(document.referrer) : null)

  const titleSelectors = [
    '[class*="course-title" i]',
    '[class*="lesson-title" i]',
    '[class*="module-title" i]',
    '[class*="activity-title" i]',
    '[class*="video-title" i]',
    '[class*="player-title" i]',
    '[class*="header-title" i]',
    '[data-testid*="title" i]',
    'h1.title',
    'h2.title',
    'main h1',
    '[role="main"] h1',
    'header h1',
    '.video-header h1',
    '.video-header h2',
    '#video-title',
  ]
  for (const sel of titleSelectors) {
    const el = document.querySelector(sel)
    const text = el?.textContent?.trim() ?? ''
    if (isValidTitle(text)) {
      return fromUrl && !text.toLowerCase().includes(fromUrl.toLowerCase())
        ? `${text} (${fromUrl})`
        : text
    }
  }

  const h1s = Array.from(document.querySelectorAll('h1, h2, h3'))
  for (const h1 of h1s) {
    const text = h1.textContent?.trim() ?? ''
    if (isValidTitle(text)) {
      return fromUrl && !text.toLowerCase().includes(fromUrl.toLowerCase())
        ? `${text} (${fromUrl})`
        : text
    }
  }

  const docTitle = document.title
    .replace(/\s*-\s*YouTube\s*$/i, '')
    .replace(/\s*-\s*Oracle\s*University\s*$/i, '')
    .replace(/\s*\|\s*Oracle\s*.*$/i, '')
    .replace(/\s*-\s*Coursera\s*$/i, '')
    .trim()
  if (isValidTitle(docTitle)) {
    return fromUrl && !docTitle.toLowerCase().includes(fromUrl.toLowerCase())
      ? `${docTitle} (${fromUrl})`
      : docTitle
  }

  if (fromUrl) return fromUrl

  return 'Course Video'
}

function readVideoSnapshot(includeScreenshot = false): VideoSnapshot | null {
  const video = findVideo()
  if (!video) return null

  const url = new URL(location.href)
  const isYouTube = isWithinDomain(url.hostname, 'youtube.com') || url.hostname === 'youtu.be'
  const youtubeVideoId = (isWithinDomain(url.hostname, 'youtube.com') ? url.searchParams.get('v') : null)
    ?? (url.hostname === 'youtu.be' ? url.pathname.slice(1) : null)
  const pageKey = `${url.origin}${url.pathname}${url.searchParams.get('v') || url.searchParams.get('id') || url.searchParams.get('courseId') || url.searchParams.get('lessonId') || ''}`
  let videoSourcePath = ''
  if (video.currentSrc) {
    try {
      videoSourcePath = new URL(video.currentSrc, location.href).pathname
    } catch {
      videoSourcePath = ''
    }
  }
  const videoId = youtubeVideoId ?? (videoSourcePath ? `${pageKey}|${videoSourcePath}` : pageKey)
  for (const key of Array.from(url.searchParams.keys())) {
    if (/^(access_token|auth_token|id_token|refresh_token|token|secret|password|auth|signature|sig|credential|key|api_key)$/i.test(key)
      || /^x-amz-(credential|signature|security-token)$/i.test(key)) {
      url.searchParams.delete(key)
    }
  }

  const snapshot: VideoSnapshot = {
    videoId,
    videoUrl: url.toString(),
    videoTitle: extractCleanTitle(),
    timestampSeconds: Math.floor(video.currentTime),
    durationSeconds: Number.isFinite(video.duration) ? Math.floor(video.duration) : 0,
    isPlaying: !video.paused && !video.ended,
    transcriptText: collectTranscript(video.currentTime),
    platformName: isYouTube
      ? 'YouTube'
      : isWithinDomain(url.hostname, 'coursera.org')
        ? 'Coursera'
        : isWithinDomain(url.hostname, 'skillbuilder.aws')
          ? 'AWS Skill Builder'
          : isWithinDomain(url.hostname, 'oracle.com') || isWithinDomain(url.hostname, 'oracleacademy.com') || location.hostname.includes('oracle') || document.referrer.includes('oracle')
            ? 'Oracle University'
            : url.hostname,
  }

  if (includeScreenshot) {
    const frame = captureVideoFrame()
    if (frame) snapshot.screenshotDataUrl = frame
  }

  return snapshot
}

function autoOpenYouTubeTranscript(): void {
  const url = new URL(location.href)
  if (!isWithinDomain(url.hostname, 'youtube.com') && url.hostname !== 'youtu.be') return

  if (document.querySelector('ytd-transcript-segment-renderer')) return

  const expander = document.querySelector('#description ytd-text-inline-expander #expand, #expand.ytd-text-inline-expander, #description #expand') as HTMLElement | null
  if (expander && expander.offsetParent !== null) {
    expander.click()
  }

  setTimeout(() => {
    if (document.querySelector('ytd-transcript-segment-renderer')) return
    const transcriptBtn = document.querySelector(
      'ytd-video-description-transcript-section-renderer button, button[aria-label*="transcript" i], #primary button[aria-label*="transcript" i]',
    ) as HTMLElement | null
    if (transcriptBtn) {
      transcriptBtn.click()
      return
    }
    const buttons = Array.from(document.querySelectorAll('#description button, ytd-watch-metadata button')) as HTMLElement[]
    const found = buttons.find((btn) => /transcript/i.test(btn.textContent ?? ''))
    if (found) found.click()
  }, 400)
}

let intervalTimer: number | null = null

function isContextValid(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id)
}

function safeSendMessage(message: ExtensionMessage): void {
  if (!isContextValid()) {
    if (intervalTimer !== null) {
      window.clearInterval(intervalTimer)
      intervalTimer = null
    }
    return
  }
  try {
    void chrome.runtime.sendMessage(message).catch(() => {
      if (!isContextValid() && intervalTimer !== null) {
        window.clearInterval(intervalTimer)
        intervalTimer = null
      }
    })
  } catch {
    if (intervalTimer !== null) {
      window.clearInterval(intervalTimer)
      intervalTimer = null
    }
  }
}

function sendCapture(): void {
  if (!isContextValid()) return
  const snapshot = readVideoSnapshot(true)
  if (!snapshot || !currentSession || currentSession.status !== 'active') return
  if (!snapshot.isPlaying) return

  const now = Date.now()
  const currentTimestamp = snapshot.timestampSeconds
  const minSeconds = Math.max(10, currentSession.captureIntervalSeconds - 4)

  // Guard against captures firing faster than the session interval
  if (Math.abs(currentTimestamp - lastCapturedTimestamp) < minSeconds) return
  if (now - lastCapturedAtTime < (minSeconds * 1000)) return

  lastCapturedTimestamp = currentTimestamp
  lastCapturedAtTime = now
  nextCaptureAt = currentTimestamp + currentSession.captureIntervalSeconds

  if (!snapshot.transcriptText.trim()) {
    autoOpenYouTubeTranscript()
  }

  safeSendMessage({ type: 'CONTENT_CAPTURE', snapshot })
}

function setSession(session: LearningSession | null): void {
  currentSession = session
  if (currentSession?.status === 'active') {
    autoOpenYouTubeTranscript()
    const video = findVideo()
    if (video) {
      const currentSeconds = Math.floor(video.currentTime)
      nextCaptureAt = currentSeconds + currentSession.captureIntervalSeconds
      lastCapturedTimestamp = currentSeconds
      lastCapturedAtTime = Date.now()
    }
  } else {
    nextCaptureAt = 0
  }
}

function seek(timestampSeconds: number): boolean {
  const video = findVideo()
  if (!video) return false
  video.currentTime = timestampSeconds
  return true
}

globalScope.__aiNotesReadSnapshot = readVideoSnapshot
globalScope.__aiNotesCaptureFrame = captureVideoFrame
globalScope.__aiNotesSetSession = setSession
globalScope.__aiNotesSeek = seek
globalScope.__aiNotesCleanup = () => {
  if (intervalTimer !== null) {
    window.clearInterval(intervalTimer)
    intervalTimer = null
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === 'CONTENT_GET_VIDEO_STATE') {
    sendResponse({ success: true, video: readVideoSnapshot() })
    return
  }

  if (message.type === 'CONTENT_SET_SESSION') {
    setSession(message.session)
    sendResponse({ success: true })
    return
  }

  if (message.type === 'SEEK_VIDEO') {
    const success = seek(message.timestampSeconds)
    sendResponse({ success, error: success ? undefined : 'The video player is no longer available.' })
  }
})

function isDifferentVideo(snapshot: VideoSnapshot, session: LearningSession): boolean {
  if (snapshot.videoId === session.videoId) return false
  try {
    const u1 = new URL(snapshot.videoUrl)
    const u2 = new URL(session.videoUrl)
    const h1 = u1.hostname.toLowerCase()
    const h2 = u2.hostname.toLowerCase()

    if (h1.includes('skillbuilder') || h2.includes('skillbuilder')) return false
    if (h1.includes('oracle') || h2.includes('oracle')) return false
    if (h1.includes('coursera') || h2.includes('coursera')) return false

    if (isWithinDomain(h1, 'youtube.com') && isWithinDomain(h2, 'youtube.com')) {
      return u1.searchParams.get('v') !== u2.searchParams.get('v')
    }

    if (u1.origin === u2.origin) return false

    return true
  } catch {
    return false
  }
}

intervalTimer = window.setInterval(() => {
  if (!isContextValid()) {
    if (intervalTimer !== null) {
      window.clearInterval(intervalTimer)
      intervalTimer = null
    }
    return
  }
  const video = findVideo()
  if (video) {
    bufferCurrentCaptions(Math.floor(video.currentTime))
  }
  if (video && currentSession) {
    const snapshot = readVideoSnapshot()
    if (snapshot && isDifferentVideo(snapshot, currentSession)) {
      currentSession = null
      safeSendMessage({ type: 'CONTENT_VIDEO_CHANGED' } satisfies ExtensionMessage)
      return
    }
  }
  if (!video || !currentSession || currentSession.status !== 'active' || video.paused || video.ended) return
  if (video.currentTime < nextCaptureAt - currentSession.captureIntervalSeconds - 2) {
    nextCaptureAt = Math.floor(video.currentTime) + currentSession.captureIntervalSeconds
  }
  if (video.currentTime >= nextCaptureAt) sendCapture()
}, 1000)
