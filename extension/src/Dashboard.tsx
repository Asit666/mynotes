import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, BookOpen, Camera, Check, CircleAlert, Clock3, Copy, Download, FileText, Home, KeyRound, LoaderCircle, Pause, Pencil, Play, Plus, RefreshCw, Settings2, Sparkles, Square, Trash2, Video, X } from 'lucide-react'
import JSZip from 'jszip'
import { connectCurrentPage, formatTimestamp, sendExtensionMessage } from './chrome'
import { listProviderModels, listProviders, removeProviderKey, saveProviderKey, type AiProvider, type ProviderStatus } from './api'
import type { ExtensionResponse, GeneratedNote, LearningSession, VideoCapture } from './models'
import { deleteCapture, deleteNote, deleteSession, listCaptures, listNotes, listSessions, saveNote, saveSession } from './storage'

const intervals = [15, 30, 60, 120]


function compileMarkdown(session: LearningSession, notes: GeneratedNote[], captures: VideoCapture[]): string {
  const screenshotPaths = new Map(
    captures
      .filter((capture) => capture.screenshotDataUrl)
      .map((capture) => [capture.id, `assets/capture-${formatTimestamp(capture.timestampSeconds).replace(':', '-')}-${capture.id}.jpg`]),
  )
  const noteSections = notes.map((note) => {
    const capturePath = note.captureId ? screenshotPaths.get(note.captureId) : undefined
    const keyPoints = note.keyPoints.length > 0
      ? `\n### Key points\n\n${note.keyPoints.map((point) => `- ${point}`).join('\n')}\n`
      : ''
    const screenshot = capturePath ? `\n![Video frame at ${formatTimestamp(note.startTimestampSeconds)}](${capturePath})\n` : ''
    return `## ${formatTimestamp(note.startTimestampSeconds)} — ${note.title}\n\n${note.explanation}\n${keyPoints}${screenshot}`
  })

  return [
    `# ${session.videoTitle}`,
    '',
    `Source: [Watch video](${session.videoUrl})`,
    ...(session.platformName ? [`Platform: ${session.platformName}`] : []),
    '',
    `Captured on ${new Date(session.startedAt).toLocaleString()}`,
    '',
    ...noteSections,
  ].join('\n')
}


async function downloadSessionNotes(
  session: LearningSession,
  notes: GeneratedNote[],
  captures: VideoCapture[],
  customMarkdown?: string,
) {
  const screenshotPaths = new Map(
    captures
      .filter((capture) => capture.screenshotDataUrl)
      .map((capture) => [capture.id, `assets/capture-${formatTimestamp(capture.timestampSeconds).replace(':', '-')}-${capture.id}.jpg`]),
  )
  const markdown = customMarkdown || compileMarkdown(session, notes, captures)

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

function CaptureCard({
  capture,
  onRetry,
  onDelete,
}: {
  capture: VideoCapture
  onRetry: () => void
  onDelete?: () => void
}) {
  return (
    <article className="capture-card">
      <div className="timeline-marker" aria-hidden="true"><Camera size={14} /></div>
      <div className="capture-body">
        <div className="capture-heading">
          <strong>{formatTimestamp(capture.timestampSeconds)}</strong>
          <div className="capture-heading-actions">
            <span className={`processing-badge processing-${capture.processingStatus}`}>
              {capture.processingStatus === 'processing' && <LoaderCircle size={12} className="spin" aria-hidden="true" />}
              {capture.processingStatus}
            </span>
            {onDelete && (
              <button
                className="button button-icon-only button-micro button-danger-hover"
                onClick={onDelete}
                title="Delete this capture"
                aria-label="Delete this capture"
              >
                <Trash2 size={11} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        {capture.screenshotDataUrl && <img className="capture-image" src={capture.screenshotDataUrl} alt={`Video screenshot at ${formatTimestamp(capture.timestampSeconds)}`} loading="lazy" />}
        {capture.transcriptText && <p className="transcript-preview">{capture.transcriptText}</p>}
        {!capture.transcriptText && <p className="muted-copy">No caption text at this moment. Captions will resume as speech continues.</p>}
        {capture.screenshotError && (
          <p className="capture-hint">
            {capture.screenshotError.includes('Switch to the video tab')
              ? '📸 Screenshot skipped: tab was in background'
              : capture.screenshotError}
          </p>
        )}
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
  onDelete,
}: {
  note: GeneratedNote
  onSave: (note: GeneratedNote) => Promise<void>
  onSeek: (seconds: number) => void
  onDelete: (id: string) => Promise<void>
}) {
  const [draft, setDraft] = useState(note)
  const [saved, setSaved] = useState(true)
  const [copied, setCopied] = useState(false)

  function updateDraft(updates: Partial<GeneratedNote>) {
    setDraft((current) => ({ ...current, ...updates }))
    setSaved(false)
  }

  async function copyNote() {
    const points = draft.keyPoints.map((point) => `- ${point}`).join('\n')
    const text = `### [${formatTimestamp(draft.startTimestampSeconds)}] ${draft.title}\n\n${draft.explanation}${points ? `\n\n**Key Points:**\n${points}` : ''}`
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <article className="note-card">
      <div className="note-card-topbar">
        <button
          className="timestamp-badge"
          onClick={() => onSeek(note.startTimestampSeconds)}
          title={`Click to jump to ${formatTimestamp(note.startTimestampSeconds)} in video`}
        >
          <Play size={10} fill="currentColor" aria-hidden="true" />
          <span>{formatTimestamp(note.startTimestampSeconds)}</span>
        </button>
        <div className="note-top-actions">
          {note.userEdited && <span className="edited-badge">Edited</span>}
          <button
            className="button button-icon-only button-micro"
            onClick={() => void copyNote()}
            title="Copy note"
          >
            {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
          </button>
          <button
            className="button button-icon-only button-micro button-danger-hover"
            onClick={() => void onDelete(note.id)}
            title="Delete note"
            aria-label="Delete note"
          >
            <Trash2 size={12} aria-hidden="true" />
          </button>
        </div>
      </div>
      <label className="visually-hidden" htmlFor={`title-${note.id}`}>Note title</label>
      <input
        id={`title-${note.id}`}
        className="note-title-input"
        value={draft.title}
        onChange={(event) => updateDraft({ title: event.target.value })}
      />
      <label className="visually-hidden" htmlFor={`explanation-${note.id}`}>Note explanation</label>
      <textarea
        id={`explanation-${note.id}`}
        className="note-explanation-input"
        value={draft.explanation}
        rows={3}
        onChange={(event) => updateDraft({ explanation: event.target.value })}
      />
      {draft.keyPoints.length > 0 && (
        <ul className="note-points">
          {draft.keyPoints.map((point, index) => (
            <li key={`${note.id}-${index}`}>{point}</li>
          ))}
        </ul>
      )}
      {!saved && (
        <div className="note-save-bar">
          <button
            className="button button-small button-primary"
            disabled={!draft.title.trim() || !draft.explanation.trim()}
            onClick={() => {
              void onSave({ ...draft, userEdited: true, updatedAt: Date.now() })
              setSaved(true)
            }}
          >
            <Check size={13} aria-hidden="true" /> Save changes
          </button>
        </div>
      )}
    </article>
  )
}

const providerDefaults: Record<AiProvider, string> = {
  OPENAI: 'gpt-4.1-mini',
  ANTHROPIC: 'claude-sonnet-4-5',
  GEMINI: 'models/gemini-3.5-flash',
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [provider, setProvider] = useState<AiProvider>('OPENAI')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(providerDefaults.OPENAI)
  const [models, setModels] = useState<string[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
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
    setNotice('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The settings change could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  async function savePreferences(nextProvider = provider, nextModel = model) {
    const selectedModel = nextModel.trim()
    if (!selectedModel) throw new Error('Enter a model ID before saving.')
    await sendExtensionMessage({
      type: 'SET_PROVIDER_PREFERENCES',
      provider: nextProvider,
      model: selectedModel,
    })
    setNotice(`Using ${selectedModel}`)
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
        {notice && <p className="settings-notice" role="status"><Check size={15} aria-hidden="true" />{notice}</p>}
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
            const available = await saveProviderKey(provider, apiKey.trim())
            setApiKey('')
            setModels(available)
            if (!available.includes(model)) {
              setModel(available[0])
              await savePreferences(provider, available[0])
            }
            await refreshProviders()
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
            <button className="button button-primary" disabled={busy || !model.trim()} onClick={() => void run(() => savePreferences(provider, model.trim()))}>{busy ? 'Saving...' : 'Use model'}</button>
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
  const selectedSessionIdRef = useRef(selectedSessionId)
  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId
  }, [selectedSessionId])
  const [captures, setCaptures] = useState<VideoCapture[]>([])
  const [notes, setNotes] = useState<GeneratedNote[]>([])
  const [captureIntervalSeconds, setCaptureIntervalSeconds] = useState(30)
  const [quickNoteTitle, setQuickNoteTitle] = useState('')
  const [quickNoteText, setQuickNoteText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'timeline' | 'document'>('timeline')
  const [customDocumentText, setCustomDocumentText] = useState<string | null>(null)
  const [docCopied, setDocCopied] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [aiStatus, setAiStatus] = useState<{
    online: boolean
    provider: AiProvider
    model: string
    configured: boolean
  }>({
    online: false,
    provider: 'GEMINI',
    model: 'models/gemini-2.5-flash',
    configured: false,
  })

  const selectedSession = useMemo(
    () => {
      if (!selectedSessionId || selectedSessionId === 'home' || selectedSessionId === 'new') return null
      return sessions.find((session) => session.id === selectedSessionId) ?? null
    },
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

  const checkAiStatus = useCallback(async () => {
    try {
      const [savedProviders, pref] = await Promise.all([
        listProviders(),
        chrome.storage.local.get(['aiProvider', 'aiModel']),
      ])
      const currentProvider = (pref.aiProvider as AiProvider) || 'GEMINI'
      const currentModel = typeof pref.aiModel === 'string' && pref.aiModel ? pref.aiModel : 'models/gemini-2.5-flash'
      const matched = savedProviders.find((p) => p.id === currentProvider)
      setAiStatus({
        online: true,
        provider: currentProvider,
        model: currentModel,
        configured: Boolean(matched?.configured),
      })
    } catch (err) {
      console.warn('Could not connect to notes service:', err)
      setAiStatus((prev) => ({ ...prev, online: false }))
    }
  }, [])

  const refresh = useCallback(async (targetSessionId?: string) => {
    void checkAiStatus()
    const [nextState, allSessions] = await Promise.all([
      sendExtensionMessage({ type: 'UI_GET_STATE' }).catch(() => ({ success: true, session: null, video: null } as ExtensionResponse)),
      listSessions().catch(() => [] as LearningSession[]),
    ])
    const currentSelected = targetSessionId !== undefined ? targetSessionId : selectedSessionIdRef.current
    const isExplicitHome = currentSelected === 'home' || currentSelected === 'new'

    let nextSessionId = currentSelected
    if (!nextSessionId) {
      // First mount: show active recording session if running, otherwise show home screen
      nextSessionId = nextState.session?.status === 'active' ? (nextState.session.id ?? 'home') : 'home'
    } else if (isExplicitHome) {
      nextSessionId = 'home'
    } else {
      const exists = allSessions.some((session) => session.id === nextSessionId)
        || nextState.session?.id === nextSessionId
      if (!exists) {
        nextSessionId = 'home'
      }
    }

    const nextSession = nextSessionId === 'home'
      ? null
      : (allSessions.find((session) => session.id === nextSessionId)
        ?? (nextState.session?.id === nextSessionId ? nextState.session : null))

    setState(nextState)
    setSessions(nextState.session && !allSessions.some((session) => session.id === nextState.session?.id)
      ? [nextState.session, ...allSessions]
      : allSessions)

    selectedSessionIdRef.current = nextSessionId
    setSelectedSessionId(nextSessionId)

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
  }, [checkAiStatus])

  function goToHome() {
    selectedSessionIdRef.current = 'home'
    setSelectedSessionId('home')
    void refresh('home')
  }

  useEffect(() => {
    void checkAiStatus()
    void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load local notes.'))
    const listener = (message: { type?: string }) => {
      if (message.type === 'DATA_UPDATED') {
        void refresh().catch(() => {})
        void checkAiStatus()
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    const timer = window.setInterval(() => {
      void refresh().catch(() => {})
      void checkAiStatus()
    }, 3000)
    return () => {
      window.clearInterval(timer)
      chrome.runtime.onMessage.removeListener(listener)
    }
  }, [refresh, checkAiStatus])

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

  async function handleSaveTitle() {
    if (!selectedSession || !titleDraft.trim()) {
      setEditingTitle(false)
      return
    }
    const updated = { ...selectedSession, videoTitle: titleDraft.trim() }
    await saveSession(updated)
    setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    setEditingTitle(false)
  }

  async function changeInterval(seconds: number) {
    setCaptureIntervalSeconds(seconds)
    await run(() => sendExtensionMessage({ type: 'SET_CAPTURE_INTERVAL', captureIntervalSeconds: seconds }))
  }

  async function startSession() {
    await run(async () => {
      const response = await sendExtensionMessage({
        type: 'SESSION_START',
        captureIntervalSeconds,
        captureAudio: false,
      })
      const nextId = response?.session?.id ?? 'new'
      selectedSessionIdRef.current = nextId
      setSelectedSessionId(nextId)
      await refresh(nextId)
    })
  }

  async function finishSession() {
    await run(async () => {
      await sendExtensionMessage({ type: 'SESSION_STOP' })
      goToHome()
    })
  }

  async function goToNewSession() {
    goToHome()
  }

  async function seekTo(seconds: number) {
    if (!selectedSession) return
    await run(async () => {
      await chrome.tabs.update(selectedSession.tabId, { active: true })
      await sendExtensionMessage({ type: 'SEEK_VIDEO', sessionId: selectedSession.id, timestampSeconds: seconds })
    })
  }

  async function removeNote(id: string) {
    await run(async () => {
      await deleteNote(id)
      setNotes((current) => current.filter((note) => note.id !== id))
    })
  }

  async function removeCapture(id: string) {
    await run(async () => {
      await deleteCapture(id)
      setCaptures((current) => current.filter((c) => c.id !== id))
    })
  }

  async function removeCurrentSession(sessionId: string) {
    await run(async () => {
      if (sessionIsActive && activeSession?.id === sessionId) {
        await sendExtensionMessage({ type: 'SESSION_STOP' })
      }
      await deleteSession(sessionId)
      setConfirmDeleteId(null)
      goToHome()
    })
  }

  const compiledMarkdown = useMemo(() => {
    if (!selectedSession) return ''
    return compileMarkdown(selectedSession, notes, captures)
  }, [selectedSession, notes, captures])

  const documentText = customDocumentText ?? compiledMarkdown

  async function copyFullDocument() {
    await navigator.clipboard.writeText(documentText)
    setDocCopied(true)
    window.setTimeout(() => setDocCopied(false), 2000)
  }

  async function exportNotes() {
    if (selectedSession) {
      try {
        await downloadSessionNotes(selectedSession, notes, captures, customDocumentText || undefined)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not create the Markdown export.')
      }
    }
  }

  const isGenerating = captures.some((c) => c.processingStatus === 'processing')

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div
          className="dashboard-brand clickable"
          onClick={goToHome}
          role="button"
          tabIndex={0}
          title="Return to Home & View All Notes"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              goToHome()
            }
          }}
        >
          <div className="brand-mark" aria-hidden="true"><BookOpen size={17} /></div>
          <div>
            <p className="eyebrow">AI VIDEO NOTES</p>
            <p className="brand-subtitle">Smart Study Workspace</p>
          </div>
        </div>
        <div className="header-actions">
          {selectedSession && (
            <button
              type="button"
              className="button button-small button-secondary header-home-button"
              onClick={goToHome}
              title="Return to Home & view all notes"
            >
              <Home size={13} aria-hidden="true" />
              <span>All Notes</span>
            </button>
          )}
          {isGenerating ? (
            <div className="ai-status-badge ai-generating">
              <LoaderCircle size={12} className="spin" aria-hidden="true" />
              <span>Generating...</span>
            </div>
          ) : aiStatus.online && aiStatus.configured ? (
            <div className="ai-status-badge ai-online" title={`${aiStatus.provider} (${aiStatus.model}) is active and ready`}>
              <span className="ai-dot green" />
              <Sparkles size={11} aria-hidden="true" />
              <span>{aiStatus.provider === 'GEMINI' ? 'Gemini' : aiStatus.provider === 'OPENAI' ? 'OpenAI' : 'Claude'}</span>
            </div>
          ) : aiStatus.online ? (
            <button className="ai-status-badge ai-warning" onClick={() => setSettingsOpen(true)} title="Click to add API key in settings">
              <span className="ai-dot yellow" />
              <span>Key Missing</span>
            </button>
          ) : (
            <div className="ai-status-badge ai-offline" title="Spring Boot backend is not responding on http://127.0.0.1:8080">
              <span className="ai-dot red" />
              <span>Backend Offline</span>
            </div>
          )}
          <button className="button button-icon-only button-small" onClick={() => setSettingsOpen(true)} aria-label="AI provider settings" title="AI Settings">
            <Settings2 size={15} aria-hidden="true" />
          </button>
          {selectedSession && (
            <button className="button button-small button-secondary" onClick={() => void exportNotes()} disabled={notes.length === 0} aria-label="Export Markdown notes and screenshots as a ZIP archive" title="Export study notes ZIP">
              <Download size={13} aria-hidden="true" /> Export
            </button>
          )}
          <span className={`status-pill ${activeSession ? `status-${activeSession.status}` : ''}`} title={`Session status: ${activeSession?.status ?? 'Ready'}`}>
            <span className="status-dot" />
            {activeSession?.status ?? 'Ready'}
          </span>
        </div>
      </header>

      {error && <p className="inline-error dashboard-error" role="alert"><CircleAlert size={15} aria-hidden="true" />{error}</p>}

      {!selectedSession ? (
        <section className="empty-state">
          <div className="empty-icon"><Video size={24} aria-hidden="true" /></div>
          <h1>Ready when you are</h1>
          <p>Open a course or video on YouTube, Coursera, or another site to generate AI study notes as you watch.</p>
          {!state?.video ? (
            <button className="button button-primary" onClick={() => void run(connectCurrentPage)} disabled={busy}>
              <Video size={14} aria-hidden="true" /> Connect this page
            </button>
          ) : (
            <button className="button button-primary" onClick={() => void run(startSession)} disabled={busy}>
              <Play size={14} aria-hidden="true" /> Start session
            </button>
          )}
          {state?.video && (
            <div className="ready-video-card">
              <span className="platform-tag">{state.video.platformName}</span>
              <p className="ready-video-title">{state.video.videoTitle}</p>
            </div>
          )}
          {sessions.length > 0 && (
            <div className="empty-state-history">
              <span className="section-label">PREVIOUS NOTES</span>
              <div className="empty-history-list">
                {sessions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="empty-history-item"
                    onClick={() => {
                      selectedSessionIdRef.current = item.id
                      setSelectedSessionId(item.id)
                      void refresh(item.id)
                    }}
                  >
                    <BookOpen size={14} aria-hidden="true" />
                    <div className="empty-history-info">
                      <span className="empty-history-title">{item.videoTitle}</span>
                      <span className="empty-history-date">{new Date(item.startedAt).toLocaleDateString()}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="session-card">
            <div className="session-card-nav">
              <button
                type="button"
                className="button button-small button-quiet back-home-button"
                onClick={goToHome}
                title="Back to Home & All Notes"
              >
                <ArrowLeft size={14} aria-hidden="true" />
                <span>All Notes</span>
              </button>
              <button
                type="button"
                className="button button-small button-secondary new-session-button"
                onClick={goToHome}
                title="Start a new course note"
              >
                <Plus size={13} aria-hidden="true" />
                <span>New Note</span>
              </button>
            </div>
            <div className="session-card-header">
              <div className="session-title-wrap">
                <div className="session-badge-row">
                  <span className="platform-tag">{selectedSession.platformName ?? 'Web Video'}</span>
                  <span className="session-date">{new Date(selectedSession.startedAt).toLocaleDateString()}</span>
                </div>
                {editingTitle ? (
                  <form
                    className="session-title-edit-form"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void handleSaveTitle()
                    }}
                  >
                    <input
                      className="session-title-inline-input"
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onBlur={() => void handleSaveTitle()}
                      autoFocus
                    />
                  </form>
                ) : (
                  <div className="session-title-row">
                    <h1 title={selectedSession.videoTitle}>{selectedSession.videoTitle}</h1>
                    <button
                      type="button"
                      className="button-icon-subtle"
                      title="Edit course or lesson title"
                      aria-label="Edit title"
                      onClick={() => {
                        setTitleDraft(selectedSession.videoTitle)
                        setEditingTitle(true)
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                  </div>
                )}
              </div>

              <div className="session-header-actions">
                {sessions.length > 1 && (
                  <div className="session-quick-picker">
                    <select
                      value={selectedSession.id}
                      onChange={(event) => {
                        const val = event.target.value
                        if (val === 'home' || val === 'new') {
                          goToHome()
                        } else {
                          selectedSessionIdRef.current = val
                          setSelectedSessionId(val)
                          void refresh(val)
                        }
                      }}
                      title="Switch learning session"
                    >
                      <option value="home">← Back to Home / All Notes</option>
                      {sessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.videoTitle} · {new Date(s.startedAt).toLocaleDateString()}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {confirmDeleteId === selectedSession.id ? (
                  <div className="delete-confirm-row">
                    <button
                      className="button button-small button-danger"
                      onClick={() => void removeCurrentSession(selectedSession.id)}
                      title="Confirm deleting this session and all its notes"
                    >
                      Delete?
                    </button>
                    <button
                      className="button button-icon-only button-small button-quiet"
                      onClick={() => setConfirmDeleteId(null)}
                      title="Cancel"
                      aria-label="Cancel"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    className="button button-icon-only button-small button-quiet button-danger-hover"
                    onClick={() => setConfirmDeleteId(selectedSession.id)}
                    title="Delete this study note session"
                    aria-label="Delete this session"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>

            <div className="session-controls-bar">
              <label className="interval-pill" title="Automatic capture interval">
                <Clock3 size={12} aria-hidden="true" />
                <select
                  value={captureIntervalSeconds}
                  disabled={!activeSession || activeSession.id !== selectedSession.id || busy}
                  onChange={(event) => void changeInterval(Number(event.target.value))}
                >
                  {intervals.map((seconds) => <option key={seconds} value={seconds}>{seconds}s</option>)}
                </select>
              </label>

              {activeSession?.id === selectedSession.id ? (
                <>
                  <button className="button button-small button-secondary" disabled={busy} onClick={() => void run(async () => {
                    await sendExtensionMessage({ type: sessionIsActive ? 'SESSION_PAUSE' : 'SESSION_RESUME' })
                    await refresh(selectedSession.id)
                  })}>
                    {sessionIsActive ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
                    {sessionIsActive ? 'Pause' : 'Resume'}
                  </button>
                  <button className="button button-small button-primary" disabled={busy || !sessionIsActive} onClick={() => void run(async () => {
                    await sendExtensionMessage({ type: 'CAPTURE_NOW' })
                    await refresh(selectedSession.id)
                  })}>
                    <Camera size={12} aria-hidden="true" /> Capture
                  </button>
                  <button
                    className="button button-small button-quiet"
                    disabled={busy}
                    onClick={() => void finishSession()}
                    title="Finish notes for this video and return to home"
                  >
                    <Square size={11} aria-hidden="true" /> Finish
                  </button>
                </>
              ) : (
                <div className="inactive-session-controls">
                  <button className="button button-small button-primary" onClick={() => void goToNewSession()}>
                    <Plus size={13} aria-hidden="true" /> New Note
                  </button>
                </div>
              )}
            </div>

            {/* Micro-stats bar saving 80+ px */}
            <div className="micro-stats-row">
              <span className="stat-chip"><Camera size={11} aria-hidden="true" /> {captures.length} captures</span>
              <span className="stat-chip"><FileText size={11} aria-hidden="true" /> {notes.length} notes</span>
              <span className="stat-chip"><strong>{notes.filter((note) => note.userEdited).length}</strong> edited</span>
            </div>
          </section>

          <section className="learning-content">
            <div className="content-heading">
              <div className="view-mode-tabs" role="tablist">
                <button
                  className={`tab-button ${viewMode === 'timeline' ? 'active' : ''}`}
                  onClick={() => setViewMode('timeline')}
                  role="tab"
                  aria-selected={viewMode === 'timeline'}
                >
                  <Clock3 size={13} aria-hidden="true" />
                  <span>Timeline</span>
                  <span className="tab-count-badge">{notes.length}</span>
                </button>
                <button
                  className={`tab-button ${viewMode === 'document' ? 'active' : ''}`}
                  onClick={() => setViewMode('document')}
                  role="tab"
                  aria-selected={viewMode === 'document'}
                >
                  <FileText size={13} aria-hidden="true" />
                  <span>Full Note Document</span>
                </button>
              </div>
            </div>

            {viewMode === 'document' ? (
              <div className="document-preview-container">
                <div className="document-preview-toolbar">
                  <span className="section-label">FULL STUDY GUIDE (MARKDOWN)</span>
                  <div className="document-toolbar-actions">
                    <button
                      className="button button-small button-secondary"
                      onClick={() => void copyFullDocument()}
                      title="Copy compiled Markdown note to clipboard"
                    >
                      {docCopied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                      {docCopied ? 'Copied Full Note!' : 'Copy Document'}
                    </button>
                    <button
                      className="button button-small button-primary"
                      onClick={() => void exportNotes()}
                      disabled={notes.length === 0}
                      title="Export Markdown notes and screenshots as a ZIP archive"
                    >
                      <Download size={12} aria-hidden="true" /> Export ZIP
                    </button>
                  </div>
                </div>
                <div className="document-editor-wrapper">
                  <p className="document-editor-hint">
                    Review or add your own summary, explanations, or code examples below before exporting:
                  </p>
                  <textarea
                    className="document-textarea"
                    value={documentText}
                    onChange={(event) => setCustomDocumentText(event.target.value)}
                    rows={16}
                    placeholder="Your compiled study notes will appear here as moments are captured..."
                  />
                </div>
              </div>
            ) : notes.length === 0 && captures.length === 0 ? (
              <div className="timeline-empty">
                <FileText size={22} aria-hidden="true" />
                <p>Your timeline is empty</p>
                <span>Play the video to capture moments, or add a quick note below.</span>
              </div>
            ) : (
              <div className="timeline">
                {timelineItems.map((item) => 'note' in item
                  ? <NoteCard key={`${item.id}-${item.note.updatedAt}`} note={item.note} onSeek={(seconds) => void seekTo(seconds)} onSave={(updated) => run(() => saveNote(updated))} onDelete={(id) => removeNote(id)} />
                  : <CaptureCard key={item.id} capture={item.capture} onRetry={() => void run(() => sendExtensionMessage({ type: 'CAPTURE_RETRY', captureId: item.capture.id }))} onDelete={() => void removeCapture(item.capture.id)} />)}
              </div>
            )}
          </section>

          <form className="quick-note-form" onSubmit={(event) => void createQuickNote(event)}>
            <div className="quick-note-heading">
              <Plus size={15} aria-hidden="true" />
              <h2>Add quick note</h2>
              {state?.video && <span>at {formatTimestamp(state.video.timestampSeconds)}</span>}
            </div>
            <label className="visually-hidden" htmlFor="quick-note-title">Quick note title</label>
            <input id="quick-note-title" value={quickNoteTitle} onChange={(event) => setQuickNoteTitle(event.target.value)} placeholder="Topic or concept..." maxLength={200} />
            <label className="visually-hidden" htmlFor="quick-note-text">Quick note details</label>
            <textarea id="quick-note-text" value={quickNoteText} onChange={(event) => setQuickNoteText(event.target.value)} placeholder="Key takeaways, thoughts, or formulas..." rows={2} maxLength={4000} />
            <button className="button button-primary button-small" disabled={!quickNoteTitle.trim() || !quickNoteText.trim() || busy}>
              <Plus size={13} aria-hidden="true" /> Save note
            </button>
          </form>
        </>
      )}
      <footer className="dashboard-footer">Stored locally on this device · OpenAI is called only by your local backend</footer>
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </main>
  )
}
