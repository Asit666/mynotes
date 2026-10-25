import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { BookOpen, Camera, Check, CircleAlert, Clock3, Download, FileText, KeyRound, LoaderCircle, Play, Plus, RefreshCw, Settings2, Sparkles, Video, X } from 'lucide-react'
import JSZip from 'jszip'
import { connectCurrentPage, formatTimestamp, sendExtensionMessage } from './chrome'
import { listProviderModels, listProviders, removeProviderKey, saveProviderKey, type AiProvider, type ProviderStatus } from './api'
import type { ExtensionResponse, GeneratedNote, LearningSession, VideoCapture } from './models'
import { listCaptures, listNotes, listSessions, saveNote } from './storage'

const intervals = [15, 30, 60, 120]

function videoTimestampUrl(videoUrl: string, seconds: number): string {
  const url = new URL(videoUrl)
  if (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com') || url.hostname === 'youtu.be') {
    url.searchParams.set('t', `${seconds}s`)
  }
  return url.toString()
}

async function downloadSessionNotes(session: LearningSession, notes: GeneratedNote[], captures: VideoCapture[]) {
  const screenshotPaths = new Map(
    captures
      .filter((capture) => capture.screenshotDataUrl)
      .map((capture) => [capture.id, `assets/capture-${formatTimestamp(capture.timestampSeconds).replace(':', '-')}-${capture.id}.jpg`]),
  )
  const noteSections = notes.map((note) => {
    const sourceUrl = videoTimestampUrl(session.videoUrl, note.startTimestampSeconds)
    const capturePath = note.captureId ? screenshotPaths.get(note.captureId) : undefined
    const keyPoints = note.keyPoints.length > 0
      ? `\n### Key points\n\n${note.keyPoints.map((point) => `- ${point}`).join('\n')}\n`
      : ''
    const screenshot = capturePath ? `\n![Video frame at ${formatTimestamp(note.startTimestampSeconds)}](${capturePath})\n` : ''
    return `## [${formatTimestamp(note.startTimestampSeconds)} — ${note.title}](${sourceUrl})\n\n${note.explanation}\n${keyPoints}${screenshot}`
  })
  const captureSections = captures.map((capture) => {
    const path = screenshotPaths.get(capture.id)
    if (path) return `- [${formatTimestamp(capture.timestampSeconds)}](${videoTimestampUrl(session.videoUrl, capture.timestampSeconds)}) — ![Video capture](${path})`
    if (capture.screenshotError) return `- ${formatTimestamp(capture.timestampSeconds)} — Screenshot unavailable: ${capture.screenshotError}`
    return undefined
  }).filter((item): item is string => item !== undefined)

  const markdown = [
    `# ${session.videoTitle}`,
    '',
    `Source: [Watch video](${session.videoUrl})`,
    ...(session.platformName ? [`Platform: ${session.platformName}`] : []),
    '',
    `Captured on ${new Date(session.startedAt).toLocaleString()}`,
    '',
    ...noteSections,
    ...(captureSections.length ? ['', '## Screenshots', '', ...captureSections] : []),
  ].join('\n')

  const archive = new JSZip()
  archive.file('README.md', markdown)
  for (const capture of captures) {
    const screenshotPath = screenshotPaths.get(capture.id)
    const image = capture.screenshotDataUrl
    if (screenshotPath && image) {
      archive.file(screenshotPath, image.slice(image.indexOf(',') + 1), { base64: true })
    }
  }
  const blob = await archive.generateAsync({ type: 'blob' })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = `${session.videoTitle.replace(/[<>:"/\\|?*]/g, '-').trim() || 'video-notes'}-notes.zip`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

function CaptureCard({ capture, onRetry }: { capture: VideoCapture; onRetry: () => void }) {
  return (
    <article className="capture-card">
      <div className="timeline-marker" aria-hidden="true"><Camera size={14} /></div>
      <div className="capture-body">
        <div className="capture-heading">
          <strong>{formatTimestamp(capture.timestampSeconds)}</strong>
          <span className={`processing-badge processing-${capture.processingStatus}`}>
            {capture.processingStatus === 'processing' && <LoaderCircle size={12} className="spin" aria-hidden="true" />}
            {capture.processingStatus}
          </span>
        </div>
        {capture.screenshotDataUrl && <img className="capture-image" src={capture.screenshotDataUrl} alt={`Video screenshot at ${formatTimestamp(capture.timestampSeconds)}`} loading="lazy" />}
        {capture.transcriptText && <p className="transcript-preview">{capture.transcriptText}</p>}
        {!capture.transcriptText && <p className="muted-copy">No caption or transcript text was available at this time. Enable video captions or open the page transcript panel before capturing.</p>}
        {capture.screenshotError && <p className="capture-warning"><CircleAlert size={13} aria-hidden="true" /> {capture.screenshotError}</p>}
        {capture.processingError && <p className="capture-warning"><CircleAlert size={13} aria-hidden="true" /> {capture.processingError}</p>}
        {capture.processingStatus === 'failed' && (capture.transcriptText.trim() || capture.audioBase64) && <button className="button button-small button-secondary" onClick={onRetry}><RefreshCw size={13} aria-hidden="true" /> Retry AI note</button>}
      </div>
    </article>
  )
}

function NoteCard({
  note,
  onSave,
  onSeek,
}: {
  note: GeneratedNote
  onSave: (note: GeneratedNote) => Promise<void>
  onSeek: (seconds: number) => void
}) {
  const [draft, setDraft] = useState(note)
  const [saved, setSaved] = useState(true)

  function updateDraft(updates: Partial<GeneratedNote>) {
    setDraft((current) => ({ ...current, ...updates }))
    setSaved(false)
  }

  return (
    <article className="note-card">
      <div className="note-heading">
        <button className="timestamp-link" onClick={() => onSeek(note.startTimestampSeconds)} aria-label={`Seek video to ${formatTimestamp(note.startTimestampSeconds)}`}>
          <Clock3 size={14} aria-hidden="true" /> {formatTimestamp(note.startTimestampSeconds)}
        </button>
        {note.userEdited && <span className="edited-label">Edited</span>}
      </div>
      <label className="visually-hidden" htmlFor={`title-${note.id}`}>Note title</label>
      <input id={`title-${note.id}`} className="note-title-input" value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} />
      <label className="visually-hidden" htmlFor={`explanation-${note.id}`}>Note explanation</label>
      <textarea id={`explanation-${note.id}`} className="note-explanation-input" value={draft.explanation} rows={3} onChange={(event) => updateDraft({ explanation: event.target.value })} />
      {draft.keyPoints.length > 0 && (
        <ul className="note-points">{draft.keyPoints.map((point, index) => <li key={`${note.id}-${index}`}>{point}</li>)}</ul>
      )}
      <button
        className="button button-small button-secondary"
        disabled={saved || !draft.title.trim() || !draft.explanation.trim()}
        onClick={() => void onSave({ ...draft, userEdited: true, updatedAt: Date.now() })}
      >
        <Check size={14} aria-hidden="true" /> {saved ? 'Saved' : 'Save changes'}
      </button>
    </article>
  )
}

const providerDefaults: Record<AiProvider, string> = {
  OPENAI: 'gpt-4.1-mini',
  ANTHROPIC: 'claude-sonnet-4-5',
  GEMINI: 'gemini-2.5-flash',
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [provider, setProvider] = useState<AiProvider>('OPENAI')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(providerDefaults.OPENAI)
  const [models, setModels] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const status = providers.find((item) => item.id === provider)

  const refreshProviders = useCallback(async () => {
    const [savedProviders, preferences] = await Promise.all([
      listProviders(),
      chrome.storage.local.get(['aiProvider', 'aiModel']),
    ])
    setProviders(savedProviders)
    const savedProvider = savedProviders.some((item) => item.id === preferences.aiProvider)
      ? preferences.aiProvider as AiProvider
      : 'OPENAI'
    setProvider(savedProvider)
    setModel(typeof preferences.aiModel === 'string' ? preferences.aiModel : providerDefaults[savedProvider])
  }, [])

  useEffect(() => {
    void refreshProviders().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load provider settings.'))
  }, [refreshProviders])

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The settings change could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  async function savePreferences(nextProvider = provider, nextModel = model) {
    await chrome.storage.local.set({ aiProvider: nextProvider, aiModel: nextModel })
  }

  async function changeProvider(nextProvider: AiProvider) {
    setProvider(nextProvider)
    setModels([])
    const nextModel = providerDefaults[nextProvider]
    setModel(nextModel)
    await savePreferences(nextProvider, nextModel)
  }

  async function loadModels() {
    const available = await listProviderModels(provider)
    setModels(available)
    if (available.length > 0 && !available.includes(model)) {
      setModel(available[0])
      await savePreferences(provider, available[0])
    }
    if (available.length === 0) setError('No note-generation models were returned for this provider key.')
  }

  return (
    <div className="settings-backdrop">
      <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="settings-heading">
          <div>
            <span className="section-label">LOCAL CONFIGURATION</span>
            <h2 id="settings-title">AI provider settings</h2>
          </div>
          <button className="button button-icon-only" onClick={onClose} aria-label="Close settings"><X size={16} /></button>
        </header>
        <p className="settings-description">API keys are saved in Windows Credential Manager on this device. They are never stored in extension storage or returned to this page after saving.</p>
        {error && <p className="inline-error" role="alert"><CircleAlert size={15} aria-hidden="true" />{error}</p>}
        <label className="settings-field">
          <span>Provider</span>
          <select value={provider} disabled={busy} onChange={(event) => void run(() => changeProvider(event.target.value as AiProvider))}>
            <option value="OPENAI">OpenAI</option>
            <option value="ANTHROPIC">Anthropic Claude</option>
            <option value="GEMINI">Google Gemini</option>
          </select>
        </label>
        <div className="provider-status">
          <KeyRound size={15} aria-hidden="true" />
          {status?.configured ? 'API key saved in Windows Credential Manager' : 'API key not configured'}
        </div>
        <form className="settings-key-form" onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            if (!apiKey.trim()) throw new Error('Enter an API key before saving.')
            await saveProviderKey(provider, apiKey.trim())
            setApiKey('')
            await refreshProviders()
            await loadModels()
          })
        }}>
          <label className="settings-field">
            <span>{status?.configured ? 'Replace API key' : 'API key'}</span>
            <input
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Entered key is sent only to the local API"
              disabled={busy}
            />
          </label>
          <button className="button button-primary" type="submit" disabled={busy || !apiKey.trim()}>Save key</button>
          {status?.configured && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void run(async () => {
            await removeProviderKey(provider)
            setModels([])
            await refreshProviders()
          })}>Remove key</button>}
        </form>
        <div className="settings-model-row">
          <label className="settings-field">
            <span>Model ID</span>
            <input list="provider-model-options" value={model} onChange={(event) => {
              setModel(event.target.value)
            }} disabled={busy} />
            <datalist id="provider-model-options">{models.map((item) => <option key={item} value={item} />)}</datalist>
          </label>
          <div className="settings-model-actions">
            <button className="button button-secondary" disabled={busy || !status?.configured} onClick={() => void run(loadModels)}>Load available models</button>
            <button className="button button-primary" disabled={busy || !model.trim()} onClick={() => void run(() => savePreferences(provider, model.trim()))}>Use model</button>
          </div>
        </div>
        <p className="settings-footnote">Model availability depends on the provider account. You can enter a model ID manually if it is not listed.</p>
      </section>
    </div>
  )
}

export default function Dashboard() {
  const [state, setState] = useState<ExtensionResponse>()
  const [sessions, setSessions] = useState<LearningSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [captures, setCaptures] = useState<VideoCapture[]>([])
  const [notes, setNotes] = useState<GeneratedNote[]>([])
  const [captureIntervalSeconds, setCaptureIntervalSeconds] = useState(30)
  const [quickNoteTitle, setQuickNoteTitle] = useState('')
  const [quickNoteText, setQuickNoteText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? sessions[0],
    [selectedSessionId, sessions],
  )
  const activeSession = state?.session ?? null
  const sessionIsActive = activeSession?.status === 'active'
  const timelineItems = useMemo(() => [
    ...notes.map((note) => ({
      id: note.id,
      timestampSeconds: note.startTimestampSeconds,
      note,
    })),
    ...captures.map((capture) => ({
      id: capture.id,
      timestampSeconds: capture.timestampSeconds,
      capture,
    })),
  ].sort((left, right) => left.timestampSeconds - right.timestampSeconds), [captures, notes])

  const refresh = useCallback(async () => {
    const [nextState, allSessions] = await Promise.all([
      sendExtensionMessage({ type: 'UI_GET_STATE' }),
      listSessions(),
    ])
    const nextSessionId = selectedSessionId || nextState.session?.id || allSessions[0]?.id || ''
    const nextSession = allSessions.find((session) => session.id === nextSessionId)
      ?? nextState.session
      ?? allSessions[0]
    setState(nextState)
    setSessions(nextState.session && !allSessions.some((session) => session.id === nextState.session?.id)
      ? [nextState.session, ...allSessions]
      : allSessions)
    setSelectedSessionId(nextSession?.id ?? '')

    if (nextSession) {
      const [nextCaptures, nextNotes] = await Promise.all([
        listCaptures(nextSession.id),
        listNotes(nextSession.id),
      ])
      setCaptures(nextCaptures)
      setNotes(nextNotes)
      setCaptureIntervalSeconds(nextSession.captureIntervalSeconds)
    } else {
      setCaptures([])
      setNotes([])
    }
  }, [selectedSessionId])

  useEffect(() => {
    void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load local notes.'))
    const listener = (message: { type?: string }) => {
      if (message.type === 'DATA_UPDATED') {
        void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not refresh local notes.'))
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    const timer = window.setInterval(() => {
      void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not refresh local notes.'))
    }, 4000)
    return () => {
      window.clearInterval(timer)
      chrome.runtime.onMessage.removeListener(listener)
    }
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

  async function createQuickNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedSession || !quickNoteTitle.trim() || !quickNoteText.trim()) return
    const timestampSeconds = activeSession?.id === selectedSession.id
      ? state?.video?.timestampSeconds ?? 0
      : captures.at(-1)?.timestampSeconds ?? 0
    const now = Date.now()
    const note: GeneratedNote = {
      id: crypto.randomUUID(),
      sessionId: selectedSession.id,
      title: quickNoteTitle.trim(),
      explanation: quickNoteText.trim(),
      keyPoints: [],
      startTimestampSeconds: timestampSeconds,
      createdAt: now,
      updatedAt: now,
      userEdited: true,
    }
    await run(async () => {
      await saveNote(note)
      setQuickNoteTitle('')
      setQuickNoteText('')
    })
  }

  async function changeInterval(seconds: number) {
    setCaptureIntervalSeconds(seconds)
    await run(() => sendExtensionMessage({ type: 'SET_CAPTURE_INTERVAL', captureIntervalSeconds: seconds }))
  }

  async function seekTo(seconds: number) {
    if (!selectedSession) return
    await run(async () => {
      await chrome.tabs.update(selectedSession.tabId, { active: true })
      await sendExtensionMessage({ type: 'SEEK_VIDEO', sessionId: selectedSession.id, timestampSeconds: seconds })
    })
  }

  async function exportNotes() {
    if (selectedSession) {
      try {
        await downloadSessionNotes(selectedSession, notes, captures)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not create the Markdown export.')
      }
    }
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <div className="brand-mark" aria-hidden="true"><BookOpen size={19} /></div>
          <div>
            <p className="eyebrow">AI VIDEO NOTES</p>
            <p className="brand-subtitle">Your learning workspace</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="button button-icon-only" onClick={() => setSettingsOpen(true)} aria-label="AI provider settings"><Settings2 size={16} aria-hidden="true" /></button>
          {selectedSession && (
            <button className="button button-small button-secondary" onClick={() => void exportNotes()} disabled={notes.length === 0} aria-label="Export Markdown notes and screenshots as a ZIP archive">
              <Download size={15} aria-hidden="true" /> Export
            </button>
          )}
          <span className={`status-pill ${activeSession ? `status-${activeSession.status}` : ''}`}>
            <span className="status-dot" />
            {activeSession?.status ?? 'Ready'}
          </span>
        </div>
      </header>

      {error && <p className="inline-error dashboard-error" role="alert"><CircleAlert size={15} aria-hidden="true" />{error}</p>}

      {!selectedSession ? (
        <section className="empty-state">
          <div className="empty-icon"><Video size={26} aria-hidden="true" /></div>
          <h1>Ready when you are</h1>
          <p>Open a course video on YouTube, Coursera, AWS Skill Builder, Oracle Academy, or another site, then connect that page.</p>
          <button className="button button-primary" onClick={() => void run(connectCurrentPage)} disabled={busy}><Video size={15} aria-hidden="true" /> Connect this page</button>
          {state?.video && <p className="ready-video"><Video size={15} aria-hidden="true" /> {state.video.platformName}: {state.video.videoTitle}</p>}
        </section>
      ) : (
        <>
          <section className="session-card">
            <div className="session-heading">
              <div className="video-icon"><Video size={17} aria-hidden="true" /></div>
              <div className="session-title">
                <span className="section-label">LEARNING SESSION</span>
                <h1>{selectedSession.videoTitle}</h1>
              </div>
              <a className="source-link" href={selectedSession.videoUrl} target="_blank" rel="noreferrer" aria-label="Open source video">
                <Play size={15} aria-hidden="true" />
              </a>
            </div>
            <div className="session-meta">
              <span>{new Date(selectedSession.startedAt).toLocaleDateString()}</span>
              <span className="meta-separator" aria-hidden="true">·</span>
              <label className="interval-inline">
                <Clock3 size={14} aria-hidden="true" />
                <span className="visually-hidden">Capture interval</span>
                <select value={captureIntervalSeconds} disabled={!activeSession || activeSession.id !== selectedSession.id || busy} onChange={(event) => void changeInterval(Number(event.target.value))}>
                  {intervals.map((seconds) => <option key={seconds} value={seconds}>Every {seconds}s</option>)}
                </select>
              </label>
              {activeSession?.id === selectedSession.id && (
                <div className="session-controls">
                  <button className="button button-small button-secondary" disabled={busy} onClick={() => void run(() => sendExtensionMessage({ type: sessionIsActive ? 'SESSION_PAUSE' : 'SESSION_RESUME' }))}>
                    {sessionIsActive ? 'Pause' : 'Resume'}
                  </button>
                  <button className="button button-small button-primary" disabled={busy || !sessionIsActive} onClick={() => void run(() => sendExtensionMessage({ type: 'CAPTURE_NOW' }))}>
                    <Camera size={14} aria-hidden="true" /> Capture now
                  </button>
                  <button className="button button-small button-quiet" disabled={busy} onClick={() => void run(() => sendExtensionMessage({ type: 'SESSION_STOP' }))}>Finish</button>
                </div>
              )}
            </div>
            <p className="session-tip"><Sparkles size={14} aria-hidden="true" /> {selectedSession.platformName ?? 'Web video'} · Captions are read from available video tracks or the visible transcript. {selectedSession.captureAudio ? 'Opt-in audio fallback is on for intervals without captions.' : 'Audio fallback is off.'} Captures are saved locally even when AI is unavailable.</p>
          </section>

          <section className="metrics-row" aria-label="Session totals">
            <div className="metric-card"><span className="metric-value">{captures.length}</span><span className="metric-label">Captures</span></div>
            <div className="metric-card"><span className="metric-value">{notes.length}</span><span className="metric-label">Notes</span></div>
            <div className="metric-card"><span className="metric-value">{notes.filter((note) => note.userEdited).length}</span><span className="metric-label">Edited by you</span></div>
          </section>

          {sessions.length > 1 && (
            <label className="session-picker">
              <span className="section-label">RECENT SESSIONS</span>
              <select value={selectedSession.id} onChange={(event) => setSelectedSessionId(event.target.value)}>
                {sessions.map((session) => <option key={session.id} value={session.id}>{session.videoTitle} · {new Date(session.startedAt).toLocaleDateString()}</option>)}
              </select>
            </label>
          )}

          <section className="learning-content">
            <div className="content-heading">
              <div>
                <span className="section-label">YOUR NOTES</span>
                <h2>Learning timeline</h2>
              </div>
              <span className="content-count">{captures.length + notes.length} items</span>
            </div>

            {notes.length === 0 && captures.length === 0 ? (
              <div className="timeline-empty">
                <FileText size={21} aria-hidden="true" />
                <p>Your timeline is empty</p>
                <span>Start playback to capture moments, or add a quick note below.</span>
              </div>
            ) : (
              <div className="timeline">
                {timelineItems.map((item) => 'note' in item
                  ? <NoteCard key={`${item.id}-${item.note.updatedAt}`} note={item.note} onSeek={(seconds) => void seekTo(seconds)} onSave={(updated) => run(() => saveNote(updated))} />
                  : <CaptureCard key={item.id} capture={item.capture} onRetry={() => void run(() => sendExtensionMessage({ type: 'CAPTURE_RETRY', captureId: item.capture.id }))} />)}
              </div>
            )}
          </section>

          <form className="quick-note-form" onSubmit={(event) => void createQuickNote(event)}>
            <div className="quick-note-heading">
              <Plus size={16} aria-hidden="true" />
              <h2>Quick note</h2>
              {state?.video && <span>at {formatTimestamp(state.video.timestampSeconds)}</span>}
            </div>
            <label className="visually-hidden" htmlFor="quick-note-title">Quick note title</label>
            <input id="quick-note-title" value={quickNoteTitle} onChange={(event) => setQuickNoteTitle(event.target.value)} placeholder="What do you want to remember?" maxLength={200} />
            <label className="visually-hidden" htmlFor="quick-note-text">Quick note details</label>
            <textarea id="quick-note-text" value={quickNoteText} onChange={(event) => setQuickNoteText(event.target.value)} placeholder="Add your own observation…" rows={2} maxLength={4000} />
            <button className="button button-primary button-small" disabled={!quickNoteTitle.trim() || !quickNoteText.trim() || busy}>
              <Plus size={14} aria-hidden="true" /> Add note
            </button>
          </form>
        </>
      )}
      <footer className="dashboard-footer">Stored locally on this device · OpenAI is called only by your local backend</footer>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </main>
  )
}
