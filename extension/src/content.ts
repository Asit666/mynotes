import type { ExtensionMessage, LearningSession, VideoSnapshot } from './models'

let currentSession: LearningSession | null = null
let nextCaptureAt = 0

function isWithinDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function findVideo(): HTMLVideoElement | null {
  return Array.from(document.querySelectorAll('video'))
    .filter((video) => Number.isFinite(video.duration) && video.duration > 0)
    .sort((left, right) => Number(right === document.activeElement) - Number(left === document.activeElement)
      || Number(!right.paused) - Number(!left.paused)
      || right.clientWidth * right.clientHeight - left.clientWidth * left.clientHeight)[0] ?? null
}

function parseTimestamp(value: string): number | undefined {
  const parts = value.trim().split(':').map(Number)
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) return undefined
  return parts.reduce((total, part) => total * 60 + part, 0)
}

function collectTranscript(timestampSeconds: number): string {
  const youtubeSegments = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'))
    .map((segment) => {
      const timestamp = segment.querySelector('.segment-timestamp')?.textContent ?? ''
      const text = segment.querySelector('.segment-text')?.textContent?.trim() ?? ''
      return { timestampSeconds: parseTimestamp(timestamp), text }
    })
    .filter((segment) => segment.timestampSeconds !== undefined && segment.text.length > 0)
    .filter((segment) => Math.abs(segment.timestampSeconds! - timestampSeconds) <= 30)
    .map((segment) => segment.text)

  if (youtubeSegments.length > 0) return youtubeSegments.join('\n')

  const trackCues = Array.from(document.querySelectorAll('video'))
    .flatMap((video) => Array.from(video.textTracks))
    .flatMap((track) => Array.from(track.cues ?? []))
    .filter((cue) => cue.startTime <= timestampSeconds + 30 && cue.endTime >= timestampSeconds - 30)
    .map((cue) => cue instanceof VTTCue ? cue.text.trim() : '')
    .filter(Boolean)

  if (trackCues.length > 0) return [...new Set(trackCues)].join('\n')

  const visibleTranscript = Array.from(document.querySelectorAll(
    '[class*="transcript" i] [class*="segment" i], [class*="transcript" i] [class*="caption" i], [class*="subtitle" i]',
  ))
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => element.textContent?.trim() ?? '')
    .filter((text) => text.length > 0 && text.length < 2000)

  return [...new Set(visibleTranscript)].slice(-30).join('\n')
}

function readVideoSnapshot(): VideoSnapshot | null {
  const video = findVideo()
  if (!video) return null

  const url = new URL(location.href)
  const isYouTube = isWithinDomain(url.hostname, 'youtube.com') || url.hostname === 'youtu.be'
  const youtubeVideoId = (isWithinDomain(url.hostname, 'youtube.com') ? url.searchParams.get('v') : null)
    ?? (url.hostname === 'youtu.be' ? url.pathname.slice(1) : null)
  const videoId = youtubeVideoId
    ?? [url.origin, url.pathname, video.currentSrc ? new URL(video.currentSrc, location.href).pathname : '', document.title, Math.floor(video.duration)]
      .join('|')
  for (const key of Array.from(url.searchParams.keys())) {
    if (/^(access_token|auth_token|id_token|refresh_token|token|secret|password|auth|signature|sig|credential|key|api_key)$/i.test(key)
      || /^x-amz-(credential|signature|security-token)$/i.test(key)) {
      url.searchParams.delete(key)
    }
  }

  return {
    videoId,
    videoUrl: url.toString(),
    videoTitle: document.querySelector('h1')?.textContent?.trim()
      || document.title.replace(/\s*-\s*YouTube\s*$/, '').trim()
      || 'Untitled video',
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
          : isWithinDomain(url.hostname, 'oracle.com') || isWithinDomain(url.hostname, 'oracleacademy.com')
            ? 'Oracle Academy'
            : url.hostname,
  }
}

function sendCapture(): void {
  const snapshot = readVideoSnapshot()
  if (!snapshot || !currentSession) return

  nextCaptureAt = snapshot.timestampSeconds + currentSession.captureIntervalSeconds
  const message: ExtensionMessage = { type: 'CONTENT_CAPTURE', snapshot }
  void chrome.runtime.sendMessage(message).catch((error: unknown) => {
    console.error('Could not save the video capture.', error)
  })
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === 'CONTENT_GET_VIDEO_STATE') {
    sendResponse({ success: true, video: readVideoSnapshot() })
    return
  }

  if (message.type === 'CONTENT_SET_SESSION') {
    currentSession = message.session
    const snapshot = readVideoSnapshot()
    nextCaptureAt = snapshot && currentSession
      ? snapshot.timestampSeconds + currentSession.captureIntervalSeconds
      : 0
    sendResponse({ success: true })
    return
  }

  if (message.type === 'SEEK_VIDEO') {
    const video = findVideo()
    if (!video) {
      sendResponse({ success: false, error: 'The video player is no longer available.' })
      return
    }
    video.currentTime = message.timestampSeconds
    sendResponse({ success: true })
  }
})

window.setInterval(() => {
  const video = findVideo()
  if (video && currentSession) {
    const snapshot = readVideoSnapshot()
    if (snapshot && snapshot.videoId !== currentSession.videoId) {
      currentSession = null
      void chrome.runtime.sendMessage({ type: 'CONTENT_VIDEO_CHANGED' } satisfies ExtensionMessage)
        .catch((error: unknown) => console.error('Could not pause after the course video changed.', error))
      return
    }
  }
  if (!video || !currentSession || currentSession.status !== 'active' || video.paused || video.ended) return
  if (video.currentTime >= nextCaptureAt) sendCapture()
}, 1000)
