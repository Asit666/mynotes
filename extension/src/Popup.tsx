import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Camera, CircleAlert, ExternalLink, Pause, Play, Square, Video } from 'lucide-react'
import type { ExtensionResponse } from './models'
import { connectCurrentPage, formatTimestamp, sendExtensionMessage } from './chrome'
import { listProviders } from './api'

const intervals = [15, 30, 60, 120]

export default function Popup() {
  const [state, setState] = useState<ExtensionResponse>()
  const [captureIntervalSeconds, setCaptureIntervalSeconds] = useState(30)
  const [captureAudio, setCaptureAudio] = useState(false)
  const [openAiStatus, setOpenAiStatus] = useState<'loading' | 'configured' | 'missing' | 'unavailable'>('loading')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const nextState = await sendExtensionMessage({ type: 'UI_GET_STATE' })
    setState(nextState)
    const savedSettings = await chrome.storage.local.get('captureIntervalSeconds')
    if (typeof savedSettings.captureIntervalSeconds === 'number') {
      setCaptureIntervalSeconds(savedSettings.captureIntervalSeconds)
    }
  }, [])

  useEffect(() => {
    void refresh().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not read the active tab.')
    })
    const listener = () => {
      void refresh().catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not refresh session status.')
      })
    }
    chrome.runtime.onMessage.addListener(listener)
    void listProviders()
      .then((providers) => setOpenAiStatus(providers.some((provider) => provider.id === 'OPENAI' && provider.configured) ? 'configured' : 'missing'))
      .catch(() => setOpenAiStatus('unavailable'))
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [refresh])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await action()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The action could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  async function changeInterval(value: number) {
    setCaptureIntervalSeconds(value)
    await chrome.storage.local.set({ captureIntervalSeconds: value })
    if (state?.session) {
      await run(() => sendExtensionMessage({ type: 'SET_CAPTURE_INTERVAL', captureIntervalSeconds: value }))
    }
  }

  async function openDashboard() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    if (!tab?.windowId) throw new Error('The browser window is not available.')
    await chrome.sidePanel.open({ windowId: tab.windowId })
  }

  async function startSession() {
    if (captureAudio) {
      const granted = await chrome.permissions.request({ permissions: ['tabCapture', 'offscreen'] })
      if (!granted) throw new Error('Audio capture permission was not granted.')
    }
    await sendExtensionMessage({
      type: 'SESSION_START',
      captureIntervalSeconds,
      captureAudio,
    })
  }

  const session = state?.session ?? null
  const video = state?.video ?? null
  const sessionIsActive = session?.status === 'active'

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <div className="brand-mark" aria-hidden="true"><Video size={19} /></div>
        <div>
          <p className="eyebrow">AI VIDEO NOTES</p>
          <p className="brand-subtitle">Learn as you watch</p>
        </div>
        <span className={`status-dot ${session ? `status-${session.status}` : ''}`} aria-label={session ? `Session ${session.status}` : 'No active session'} />
      </header>

      <section className="popup-video" aria-live="polite">
        <span className="section-label">CURRENT VIDEO</span>
        <h1>{video?.videoTitle ?? session?.videoTitle ?? 'Connect a course video to begin'}</h1>
        {video && <p className="muted-copy">{formatTimestamp(video.timestampSeconds)} of {formatTimestamp(video.durationSeconds)}</p>}
        {video && <p className="muted-copy">{video.platformName}</p>}
      </section>

      <label className="interval-control">
        <span>Capture interval</span>
        <select
          aria-label="Capture interval"
          value={captureIntervalSeconds}
          onChange={(event) => void changeInterval(Number(event.target.value)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not update the interval.'))}
        >
          {intervals.map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
        </select>
      </label>

      {!session && (
        <div className="audio-opt-in">
          <label>
            <input type="checkbox" checked={captureAudio} disabled={busy} onChange={(event) => setCaptureAudio(event.target.checked)} />
            <span>Transcribe audio when captions are unavailable</span>
          </label>
          <p>Optional. Records tab audio during this session; only intervals without captions are sent to OpenAI for transcription. Requires an OpenAI key in dashboard settings; provider usage charges may apply.</p>
          {openAiStatus === 'missing' && <p className="audio-requirement">OpenAI is not configured. Set its key in the dashboard before enabling this option.</p>}
          {openAiStatus === 'unavailable' && <p className="audio-requirement">The local API is unavailable. Start it and save an OpenAI key in dashboard settings.</p>}
        </div>
      )}

      <div className="popup-actions">
        {!video && !session && (
          <button className="button button-secondary button-wide" disabled={busy} onClick={() => void run(connectCurrentPage)}>
            <ExternalLink size={16} aria-hidden="true" /> Connect this page
          </button>
        )}
        {!session && (
          <button className="button button-primary button-wide" disabled={busy || !video || (captureAudio && openAiStatus !== 'configured')} onClick={() => void run(startSession)}>
            <Play size={16} aria-hidden="true" /> Start session
          </button>
        )}
        {session && (
          <div className="button-row">
            <button className="button button-primary" disabled={busy} onClick={() => void run(() => sendExtensionMessage({ type: sessionIsActive ? 'SESSION_PAUSE' : 'SESSION_RESUME' }))}>
              {sessionIsActive ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
              {sessionIsActive ? 'Pause' : 'Resume'}
            </button>
            <button className="button button-secondary" disabled={busy} onClick={() => void run(() => sendExtensionMessage({ type: 'CAPTURE_NOW' }))}>
              <Camera size={16} aria-hidden="true" /> Capture
            </button>
            <button className="button button-icon-only" aria-label="Stop session" disabled={busy} onClick={() => void run(() => sendExtensionMessage({ type: 'SESSION_STOP' }))}>
              <Square size={15} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {error && <p className="inline-error" role="alert"><CircleAlert size={15} aria-hidden="true" />{error}</p>}

      <button className="dashboard-link" onClick={() => void run(openDashboard)}>
        <BookOpen size={16} aria-hidden="true" />
        Open learning dashboard
        <ExternalLink size={14} aria-hidden="true" />
      </button>
    </main>
  )
}
