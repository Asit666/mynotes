import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import JSZip from 'jszip'
import PondBackground from './PondBackground'
import { connectCurrentPage, formatTimestamp, sendExtensionMessage } from './chrome'
import {
  askNote,
  generateSummary,
  listProviderModels,
  listProviders,
  removeProviderKey,
  saveProviderKey,
  type AiProvider,
  type ProviderStatus,
} from './api'
import type { ExtensionResponse, GeneratedNote, LearningSession, NoteGroup, VideoCapture } from './models'
import {
  deleteGroup as storageDeleteGroup,
  deleteNote as storageDeleteNote,
  deleteSession as storageDeleteSession,
  getSession,
  listCaptures,
  listGroups,
  listNotes,
  listSessions,
  saveGroup as storageSaveGroup,
  saveNote as storageSaveNote,
  saveSession,
} from './storage'

const intervals = [15, 30, 60, 120]

interface AskAiProposal {
  id: string
  sessionId: string
  prompt: string
  title: string
  explanation: string
  keyPoints: string[]
  timestampSeconds: number
  added: boolean
  createdAt: number
}

const PROVIDER_NAMES: Record<AiProvider, string> = {
  GEMINI: 'Google Gemini',
  OPENAI: 'OpenAI',
  ANTHROPIC: 'Anthropic Claude',
}

const PROVIDER_DEFAULTS: Record<AiProvider, string> = {
  GEMINI: 'models/gemini-3.1-flash-lite',
  OPENAI: 'gpt-4.1-mini',
  ANTHROPIC: 'claude-sonnet-4-5',
}

const SUGGESTED_MODELS: Record<AiProvider, string[]> = {
  GEMINI: [
    'models/gemini-3.1-flash-lite',
    'models/gemini-flash-lite-latest',
    'models/gemini-3.8-flash',
    'models/gemini-3.5-flash-lite',
    'models/gemini-flash-latest',
    'models/gemini-pro-latest',
  ],
  OPENAI: ['gpt-4.1-mini', 'gpt-4.1-preview', 'o4-mini', 'gpt-4o', 'gpt-4o-mini'],
  ANTHROPIC: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5'],
}

function compileMarkdown(session: LearningSession, notes: GeneratedNote[], captures: VideoCapture[]): string {
  const screenshotPaths = new Map(
    captures
      .filter((capture) => capture.screenshotDataUrl)
      .map((capture) => [
        capture.id,
        `assets/capture-${formatTimestamp(capture.timestampSeconds).replace(':', '-')}-${capture.id}.jpg`,
      ]),
  )
  const noteSections = notes.map((note) => {
    const capturePath = note.captureId ? screenshotPaths.get(note.captureId) : undefined
    const keyPoints =
      note.keyPoints.length > 0
        ? `\n### Key points\n\n${note.keyPoints.map((point) => `- ${point}`).join('\n')}\n`
        : ''
    const screenshot = capturePath ? `\n![Video frame at ${formatTimestamp(note.startTimestampSeconds)}](${capturePath})\n` : ''
    return `## ${formatTimestamp(note.startTimestampSeconds)} — ${note.title}\n\n${note.explanation}\n${keyPoints}${screenshot}`
  })

  const summarySection = session.summary
    ? ['## Executive Summary & Study Overview', '', session.summary, '', '---', '']
    : []

  return [
    `# ${session.videoTitle}`,
    '',
    `Source: [Watch video](${session.videoUrl})`,
    ...(session.platformName ? [`Platform: ${session.platformName}`] : []),
    '',
    `Captured on ${new Date(session.startedAt).toLocaleString()}`,
    '',
    ...summarySection,
    ...noteSections,
  ].join('\n')
}

export default function Dashboard() {
  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('avn-theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [motionPaused, setMotionPaused] = useState(() => {
    try {
      return localStorage.getItem('avn-motion-paused') === 'true'
    } catch {
      return false
    }
  })

  // Navigation / View
  const [view, setView] = useState<'home' | 'note'>('home')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const selectedSessionIdRef = useRef(selectedSessionId)
  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId
  }, [selectedSessionId])

  // Data
  const [state, setState] = useState<ExtensionResponse>()
  const [sessions, setSessions] = useState<LearningSession[]>([])
  const [groups, setGroups] = useState<NoteGroup[]>([])
  const [captures, setCaptures] = useState<VideoCapture[]>([])
  const [notes, setNotes] = useState<GeneratedNote[]>([])

  // Filters & Tabs
  const [activeGroupId, setActiveGroupId] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'tl' | 'doc' | 'sum' | 'ask'>('tl')

  // Ask AI / Note Enrichment State
  const [askPrompt, setAskPrompt] = useState('')
  const [isAskingAi, setIsAskingAi] = useState(false)
  const [askAutoUpdateSummary, setAskAutoUpdateSummary] = useState(true)
  const [askProposals, setAskProposals] = useState<AskAiProposal[]>(() => {
    try {
      const saved = localStorage.getItem('avn_ask_proposals')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('avn_ask_proposals', JSON.stringify(askProposals))
    } catch {}
  }, [askProposals])

  // Document Editor State
  const [docCustomText, setDocCustomText] = useState('')
  const [docEdited, setDocEdited] = useState(false)

  // Alert & Toast
  const [serviceAlert, setServiceAlert] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [toastUndo, setToastUndo] = useState<(() => void) | null>(null)
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Modals & Popups
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [newNoteModalOpen, setNewNoteModalOpen] = useState(false)
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [assignSessionOnCreateId, setAssignSessionOnCreateId] = useState<string | null>(null)
  const [addNotesModalOpen, setAddNotesModalOpen] = useState(false)
  const [selectedNotesToAdd, setSelectedNotesToAdd] = useState<string[]>([])
  const [addNotesSearch, setAddNotesSearch] = useState('')
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [noteCardMenuId, setNoteCardMenuId] = useState<string | null>(null)

  // AI Provider state
  const [provider, setProvider] = useState<AiProvider>('GEMINI')
  const [model, setModel] = useState<string>(PROVIDER_DEFAULTS.GEMINI)
  const [providersStatus, setProvidersStatus] = useState<ProviderStatus[]>([])
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [aiBusy, setAiBusy] = useState(false)

  // Form states
  const [newTitle, setNewTitle] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newGroupId, setNewGroupId] = useState('')
  const [groupNameInput, setGroupNameInput] = useState('')
  const [quickNoteText, setQuickNoteText] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [isSummarizing, setIsSummarizing] = useState(false)

  const showToast = useCallback((msg: string, undo?: () => void) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current)
    setToastMessage(msg)
    setToastUndo(() => undo ?? null)
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null)
      setToastUndo(null)
    }, undo ? 4500 : 2500)
  }, [])

  const toggleMotion = () => {
    setMotionPaused((prev) => {
      const next = !prev
      try {
        localStorage.setItem('avn-motion-paused', String(next))
      } catch {}
      showToast(next ? 'Background motion paused' : 'Background motion playing')
      return next
    })
  }

  // Sync theme with HTML document
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('avn-theme', theme)
    } catch {}
  }, [theme])

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }

  // Active / selected session
  const activeSession = state?.session ?? null
  const selectedSession = useMemo(() => {
    if (!selectedSessionId || selectedSessionId === 'home') return null
    return sessions.find((s) => s.id === selectedSessionId) ?? (activeSession?.id === selectedSessionId ? activeSession : null)
  }, [selectedSessionId, sessions, activeSession])

  // Current video state from tab
  const currentVideo = state?.video ?? null
  const maxCaptureTs = captures.reduce((max, c) => Math.max(max, c.timestampSeconds), 0)
  const currentDuration = (currentVideo && currentVideo.durationSeconds > 0)
    ? currentVideo.durationSeconds
    : Math.max(maxCaptureTs, selectedSession?.endedAt ? Math.round((selectedSession.endedAt - selectedSession.startedAt) / 1000) : 0)
  const currentTimestamp = activeSession?.id === selectedSession?.id && currentVideo ? currentVideo.timestampSeconds : maxCaptureTs
  const effectiveDuration = Math.max(currentDuration, currentTimestamp, 60)

  // Keep docCustomText updated when session/notes change unless manually edited
  useEffect(() => {
    if (selectedSession && !docEdited) {
      setDocCustomText(compileMarkdown(selectedSession, notes, captures))
    }
  }, [selectedSession, notes, captures, docEdited])

  const handleRetryCapture = async (captureId: string) => {
    try {
      showToast('Retrying note generation…')
      const resp = await sendExtensionMessage({ type: 'CAPTURE_RETRY', captureId })
      if (!resp.success) throw new Error(resp.error)
      if (selectedSessionIdRef.current) await refresh(selectedSessionIdRef.current)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Retry failed')
    }
  }

  // Check backend health & AI status
  const checkBackendStatus = useCallback(async () => {
    try {
      const [statuses, pref] = await Promise.all([
        listProviders(),
        chrome.storage.local.get(['aiProvider', 'aiModel']),
      ])
      setProvidersStatus(statuses)
      if (pref.aiProvider && (pref.aiProvider === 'GEMINI' || pref.aiProvider === 'OPENAI' || pref.aiProvider === 'ANTHROPIC')) {
        setProvider(pref.aiProvider)
        setModel(typeof pref.aiModel === 'string' && pref.aiModel ? pref.aiModel : PROVIDER_DEFAULTS[pref.aiProvider])
      }
      setServiceAlert(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Notes service unavailable.'
      if (msg.includes('502') || msg.includes('Failed to fetch') || msg.includes('Could not connect')) {
        setServiceAlert('Notes service unavailable. Local captures and offline notes are enabled.')
      } else {
        setServiceAlert(msg)
      }
    }
  }, [])

  // Reload sessions & groups
  const refresh = useCallback(
    async (targetId?: string) => {
      void checkBackendStatus()
      const [nextState, allSessions, allGroups] = await Promise.all([
        sendExtensionMessage({ type: 'UI_GET_STATE' }).catch(() => ({ success: true, session: null, video: null } as ExtensionResponse)),
        listSessions().catch(() => [] as LearningSession[]),
        listGroups().catch(() => [] as NoteGroup[]),
      ])

      setState(nextState)
      setGroups(allGroups)

      const mergedSessions = nextState.session && !allSessions.some((s) => s.id === nextState.session?.id)
        ? [nextState.session, ...allSessions]
        : allSessions
      setSessions(mergedSessions)

      const curId = targetId !== undefined ? targetId : selectedSessionIdRef.current
      if (curId && curId !== 'home') {
        const found = mergedSessions.find((s) => s.id === curId)
        if (found) {
          const [nextCaptures, nextNotes] = await Promise.all([listCaptures(found.id), listNotes(found.id)])
          setCaptures(nextCaptures)
          setNotes(nextNotes)
        }
      } else if (selectedSessionIdRef.current === null) {
        // Auto-open running session if active on startup
        if (nextState.session && (nextState.session.status === 'active' || nextState.session.status === 'paused')) {
          selectedSessionIdRef.current = nextState.session.id
          setSelectedSessionId(nextState.session.id)
          setView('note')
          const [nextCaptures, nextNotes] = await Promise.all([listCaptures(nextState.session.id), listNotes(nextState.session.id)])
          setCaptures(nextCaptures)
          setNotes(nextNotes)
        }
      }
    },
    [checkBackendStatus],
  )

  useEffect(() => {
    void refresh()
    const listener = (msg: { type?: string }) => {
      if (msg.type === 'DATA_UPDATED') {
        void refresh()
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    const interval = setInterval(() => void refresh(), 2500)
    return () => {
      clearInterval(interval)
      chrome.runtime.onMessage.removeListener(listener)
    }
  }, [refresh])

  // Navigation handlers
  const openNote = (id: string) => {
    selectedSessionIdRef.current = id
    setSelectedSessionId(id)
    setView('note')
    setActiveTab('tl')
    setNoteCardMenuId(null)
    setDocEdited(false)
    void refresh(id)
  }

  const goHome = () => {
    selectedSessionIdRef.current = 'home'
    setSelectedSessionId('home')
    setView('home')
    setNoteCardMenuId(null)
    void refresh('home')
  }

  // Connect active page video
  const handleConnectCurrentTab = async () => {
    try {
      showToast('Detecting video on active tab…')
      const resp = await connectCurrentPage()
      if (resp.video) {
        showToast(`Detected: ${resp.video.videoTitle}`)
      } else {
        showToast('No video playing yet. Start playing the video.')
      }
      await refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not detect video')
    }
  }

  // Start note session directly from detected video
  const handleStartDetectedVideo = async () => {
    try {
      showToast('Starting video session…')
      await connectCurrentPage()
      const activeGid = activeGroupId !== 'all' && activeGroupId !== 'none' ? activeGroupId : null
      const resp = await sendExtensionMessage({
        type: 'SESSION_START',
        captureIntervalSeconds: 30,
        groupId: activeGid,
      })
      if (resp.session) {
        selectedSessionIdRef.current = resp.session.id
        setSelectedSessionId(resp.session.id)
        setView('note')
        await refresh(resp.session.id)
        showToast('Note session started')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not start session')
    }
  }

  // Auto-detect tab details on open "New Note"
  const handleOpenNewNoteModal = async () => {
    if (currentVideo) {
      setNewTitle(currentVideo.videoTitle)
      setNewUrl(currentVideo.videoUrl)
    } else {
      try {
        const resp = await connectCurrentPage().catch(() => null)
        if (resp?.video) {
          setNewTitle(resp.video.videoTitle)
          setNewUrl(resp.video.videoUrl)
        } else {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          if (tab) {
            setNewTitle(tab.title ? tab.title.replace(/ - YouTube$/, '').trim() : '')
            setNewUrl(tab.url || '')
          }
        }
      } catch {}
    }
    setNewGroupId(activeGroupId !== 'all' && activeGroupId !== 'none' ? activeGroupId : '')
    setNewNoteModalOpen(true)
  }

  // Create new note / session
  const handleCreateNote = async (e: FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim()) return

    const now = Date.now()
    const isYoutube = /youtu\.?be/i.test(newUrl)
    const platform = isYoutube ? 'YouTube' : newUrl ? 'Web video' : 'Manual'

    // If currently on an active tab with video, start a recording session
    try {
      if (newUrl.startsWith('http')) {
        await connectCurrentPage()
        const resp = await sendExtensionMessage({
          type: 'SESSION_START',
          captureIntervalSeconds: 30,
        })
        if (resp.session) {
          const updated = {
            ...resp.session,
            videoTitle: newTitle.trim(),
            groupId: newGroupId || null,
          }
          await saveSession(updated)
          setNewNoteModalOpen(false)
          openNote(updated.id)
          showToast('Note session started')
          return
        }
      }
    } catch {}

    // Fallback: create standalone local session
    const standaloneSession: LearningSession = {
      id: crypto.randomUUID(),
      videoId: 'manual-' + now,
      videoUrl: newUrl.trim() || 'https://local.notes',
      videoTitle: newTitle.trim(),
      platformName: platform,
      tabId: 0,
      startedAt: now,
      captureIntervalSeconds: 30,
      status: 'active',
      groupId: newGroupId || null,
    }
    await saveSession(standaloneSession)
    setNewNoteModalOpen(false)
    await refresh(standaloneSession.id)
    openNote(standaloneSession.id)
    showToast('Note created')
  }

  // Quick note creation
  const handleAddQuickNote = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedSession || !quickNoteText.trim()) return

    const ts = activeSession?.id === selectedSession.id && currentVideo ? currentVideo.timestampSeconds : captures.at(-1)?.timestampSeconds ?? 0
    const now = Date.now()
    const noteItem: GeneratedNote = {
      id: crypto.randomUUID(),
      sessionId: selectedSession.id,
      title: 'Study Note',
      explanation: quickNoteText.trim(),
      keyPoints: [],
      startTimestampSeconds: ts,
      createdAt: now,
      updatedAt: now,
      userEdited: true,
    }
    await storageSaveNote(noteItem)
    setQuickNoteText('')
    setActiveTab('tl')
    await refresh(selectedSession.id)
    showToast(`Note added at ${formatTimestamp(ts)}`)
  }

  // Note actions
  const handleDeleteNote = async (noteId: string) => {
    const deleted = notes.find((n) => n.id === noteId)
    if (!deleted || !selectedSession) return
    await storageDeleteNote(noteId)
    await refresh(selectedSession.id)
    showToast('Note deleted', () => {
      void storageSaveNote(deleted).then(() => refresh(selectedSession.id))
    })
  }

  const handleDeleteSession = async (sessionId: string) => {
    const sessionToDelete = sessions.find((s) => s.id === sessionId)
    if (!sessionToDelete) return
    await storageDeleteSession(sessionId)
    setNoteCardMenuId(null)
    if (selectedSessionId === sessionId) {
      goHome()
    } else {
      await refresh()
    }
    showToast('Note deleted', () => {
      void saveSession(sessionToDelete).then(() => refresh())
    })
  }

  const handleMoveSessionGroup = async (sessionId: string, targetGid: string | null) => {
    const targetSession =
      sessions.find((s) => s.id === sessionId) ??
      (selectedSession?.id === sessionId ? selectedSession : null) ??
      (await getSession(sessionId))
    if (!targetSession) return
    const updated = { ...targetSession, groupId: targetGid }
    await saveSession(updated)
    setNoteCardMenuId(null)
    await refresh(selectedSessionId || undefined)
    const targetGroupName = targetGid ? groups.find((g) => g.id === targetGid)?.name : null
    showToast(targetGroupName ? `Moved to ${targetGroupName}` : 'Removed from group')
  }

  // Session controls
  const handleReopenSession = async (sessionId?: string) => {
    const id = sessionId || selectedSession?.id
    if (!id) return
    try {
      await sendExtensionMessage({ type: 'SESSION_REOPEN', sessionId: id })
      showToast('Note resumed · continuing capture')
    } catch (err) {
      const target = sessions.find((s) => s.id === id) || (selectedSession?.id === id ? selectedSession : null)
      if (target) {
        const updated: LearningSession = {
          ...target,
          status: 'active',
          endedAt: undefined,
        }
        await saveSession(updated)
        showToast('Note resumed')
      } else {
        showToast(err instanceof Error ? err.message : 'Could not continue note')
      }
    }
    await refresh(id)
  }

  const handleCaptureNow = async () => {
    try {
      await sendExtensionMessage({ type: 'CAPTURE_NOW', sessionId: selectedSession?.id })
      showToast('Capturing video frame...')
      setTimeout(() => void refresh(selectedSessionId || undefined), 1200)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not capture frame')
    }
  }

  const handleTogglePause = async () => {
    if (!selectedSession) return
    try {
      if (selectedSession.status === 'paused') {
        await sendExtensionMessage({ type: 'SESSION_RESUME' })
        showToast('Resumed note session')
      } else {
        await sendExtensionMessage({ type: 'SESSION_PAUSE' })
        showToast('Paused note session')
      }
      setTimeout(() => void refresh(selectedSession.id), 500)
    } catch {
      // If not active background session, toggle locally
      const nextStatus: 'active' | 'paused' = selectedSession.status === 'paused' ? 'active' : 'paused'
      const updated: LearningSession = { ...selectedSession, status: nextStatus }
      await saveSession(updated)
      await refresh(selectedSession.id)
      showToast(nextStatus === 'paused' ? 'Session paused' : 'Session resumed')
    }
  }

  const handleFinishSession = async () => {
    if (!selectedSession) return
    try {
      await sendExtensionMessage({ type: 'SESSION_STOP' })
    } catch {}
    const updated: LearningSession = {
      ...selectedSession,
      status: 'completed',
      endedAt: Date.now(),
    }
    await saveSession(updated)
    await refresh(selectedSession.id)
    setActiveTab('sum')
    showToast('Session finished')
  }

  const handleSeek = (ts: number) => {
    if (!selectedSession) return
    try {
      void sendExtensionMessage({
        type: 'SEEK_VIDEO',
        sessionId: selectedSession.id,
        timestampSeconds: ts,
      })
      showToast(`Jumped to ${formatTimestamp(ts)}`)
    } catch {
      showToast(`At ${formatTimestamp(ts)}`)
    }
  }

  const handleSaveTitle = async () => {
    if (!selectedSession || !titleDraft.trim()) {
      setEditingTitle(false)
      return
    }
    const updated = { ...selectedSession, videoTitle: titleDraft.trim() }
    await saveSession(updated)
    setEditingTitle(false)
    await refresh(selectedSession.id)
    showToast('Title updated')
  }

  // Group creation & editing
  const handleSaveGroup = async (e: FormEvent) => {
    e.preventDefault()
    const name = groupNameInput.trim()
    if (!name) return

    if (editingGroupId) {
      const g = groups.find((item) => item.id === editingGroupId)
      if (g) {
        await storageSaveGroup({ ...g, name })
        showToast('Group renamed')
      }
    } else {
      const g: NoteGroup = { id: 'g_' + Date.now(), name, createdAt: Date.now() }
      await storageSaveGroup(g)
      setActiveGroupId(g.id)
      if (assignSessionOnCreateId) {
        await handleMoveSessionGroup(assignSessionOnCreateId, g.id)
        setAssignSessionOnCreateId(null)
      } else {
        showToast('Group created')
      }
    }
    setGroupModalOpen(false)
    setEditingGroupId(null)
    setGroupNameInput('')
    await refresh(selectedSessionId || undefined)
  }

  const handleDeleteActiveGroup = async () => {
    if (activeGroupId === 'all' || activeGroupId === 'none') return
    const g = groups.find((item) => item.id === activeGroupId)
    if (!g) return
    const affectedSessionIds = sessions.filter((s) => s.groupId === activeGroupId).map((s) => s.id)
    await storageDeleteGroup(activeGroupId)
    setActiveGroupId('all')
    await refresh()
    showToast(`Group "${g.name}" deleted. Notes kept.`, () => {
      void (async () => {
        await storageSaveGroup(g)
        for (const sid of affectedSessionIds) {
          const s = await getSession(sid)
          if (s) {
            await saveSession({ ...s, groupId: g.id })
          }
        }
        await refresh()
      })()
    })
  }

  const handleBatchAddNotesToGroup = async (e: FormEvent) => {
    e.preventDefault()
    if (!currentGroupObj || selectedNotesToAdd.length === 0) return
    try {
      for (const sid of selectedNotesToAdd) {
        const targetSession = sessions.find((s) => s.id === sid) ?? (await getSession(sid))
        if (targetSession) {
          await saveSession({ ...targetSession, groupId: currentGroupObj.id })
        }
      }
      setAddNotesModalOpen(false)
      const count = selectedNotesToAdd.length
      setSelectedNotesToAdd([])
      await refresh(selectedSessionId || undefined)
      showToast(`Added ${count} ${count === 1 ? 'note' : 'notes'} to ${currentGroupObj.name}`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not add notes')
    }
  }

  // Generate Summary
  const handleGenerateSummary = async () => {
    if (!selectedSession || notes.length === 0) return
    setIsSummarizing(true)
    try {
      const markdown = compileMarkdown(selectedSession, notes, captures)
      const res = await generateSummary({
        provider,
        model,
        videoTitle: selectedSession.videoTitle,
        videoUrl: selectedSession.videoUrl,
        fullNotesMarkdown: markdown,
      })
      const updated: LearningSession = {
        ...selectedSession,
        summary: res.formattedMarkdown,
        summaryGeneratedAt: Date.now(),
        summaryNoteCount: notes.length,
      }
      await saveSession(updated)
      await refresh(selectedSession.id)
      showToast('Review guide generated')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not generate summary')
    } finally {
      setIsSummarizing(false)
    }
  }

  // Ask AI / Enrichment Actions
  const handleAskAi = async (e?: FormEvent, customPrompt?: string) => {
    if (e) e.preventDefault()
    const query = (customPrompt || askPrompt).trim()
    if (!selectedSession || !query || isAskingAi) return

    setIsAskingAi(true)
    try {
      const notesContext = notes
        .slice(0, 15)
        .map((n) => `[${formatTimestamp(n.startTimestampSeconds)}] ${n.title}: ${n.explanation}`)
        .join('\n')

      const ts = activeSession?.id === selectedSession.id && currentVideo
        ? currentVideo.timestampSeconds
        : captures.at(-1)?.timestampSeconds ?? 0

      const result = await askNote({
        provider,
        model,
        videoTitle: selectedSession.videoTitle,
        videoUrl: selectedSession.videoUrl,
        prompt: query,
        existingNotesContext: notesContext,
        timestampSeconds: ts,
      })

      const newProposal: AskAiProposal = {
        id: crypto.randomUUID(),
        sessionId: selectedSession.id,
        prompt: query,
        title: result.title,
        explanation: result.explanation,
        keyPoints: result.keyPoints || [],
        timestampSeconds: result.startTimestampSeconds ?? ts,
        added: false,
        createdAt: Date.now(),
      }

      setAskProposals((prev) => [newProposal, ...prev])
      setAskPrompt('')
      showToast('AI note generated! Review and approve below.')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not generate AI note')
    } finally {
      setIsAskingAi(false)
    }
  }

  const handleApproveProposal = async (proposalId: string) => {
    const proposal = askProposals.find((p) => p.id === proposalId)
    if (!proposal || !selectedSession) return

    const now = Date.now()
    const newNote: GeneratedNote = {
      id: crypto.randomUUID(),
      sessionId: selectedSession.id,
      title: proposal.title,
      explanation: proposal.explanation,
      keyPoints: proposal.keyPoints,
      startTimestampSeconds: proposal.timestampSeconds,
      createdAt: now,
      updatedAt: now,
      userEdited: true,
    }

    await storageSaveNote(newNote)
    setAskProposals((prev) =>
      prev.map((p) => (p.id === proposalId ? { ...p, added: true } : p)),
    )

    const updatedNotes = [...notes, newNote].sort(
      (a, b) => a.startTimestampSeconds - b.startTimestampSeconds,
    )

    if (askAutoUpdateSummary || selectedSession.summary) {
      try {
        showToast('Adding to notes & updating review summary…')
        const markdown = compileMarkdown(selectedSession, updatedNotes, captures)
        const res = await generateSummary({
          provider,
          model,
          videoTitle: selectedSession.videoTitle,
          videoUrl: selectedSession.videoUrl,
          fullNotesMarkdown: markdown,
        })
        const updatedSession: LearningSession = {
          ...selectedSession,
          summary: res.formattedMarkdown,
          summaryGeneratedAt: Date.now(),
          summaryNoteCount: updatedNotes.length,
        }
        await saveSession(updatedSession)
        await refresh(selectedSession.id)
        showToast('Approved! Added to timeline, document, and review summary.')
        return
      } catch {
        // If summary fails, note is still added
      }
    }

    await refresh(selectedSession.id)
    showToast('Approved! Added to timeline and full document.')
  }

  const handleDismissProposal = (proposalId: string) => {
    setAskProposals((prev) => prev.filter((p) => p.id !== proposalId))
  }

  // Export & Copy
  const handleExportZip = async () => {
    if (!selectedSession) {
      showToast('Open a note to export ZIP')
      return
    }
    try {
      const archive = new JSZip()
      const markdown = docCustomText || compileMarkdown(selectedSession, notes, captures)
      archive.file('README.md', markdown)
      for (const cap of captures) {
        if (cap.screenshotDataUrl) {
          const imgBase64 = cap.screenshotDataUrl.slice(cap.screenshotDataUrl.indexOf(',') + 1)
          archive.file(`assets/capture-${formatTimestamp(cap.timestampSeconds).replace(':', '-')}-${cap.id}.jpg`, imgBase64, {
            base64: true,
          })
        }
      }
      const blob = await archive.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${selectedSession.videoTitle.replace(/[<>:"/\\|?*]/g, '-').trim() || 'video-notes'}-notes.zip`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      showToast('Exported Markdown ZIP')
    } catch {
      showToast('Could not create ZIP')
    }
  }

  const handleCopyDoc = async () => {
    if (!selectedSession) {
      showToast('Open a note to copy document')
      return
    }
    try {
      const markdown = docCustomText || compileMarkdown(selectedSession, notes, captures)
      await navigator.clipboard.writeText(markdown)
      showToast('Document copied to clipboard')
    } catch {
      showToast('Could not copy document')
    }
  }

  // AI Settings Modal actions
  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) return
    setAiBusy(true)
    try {
      const models = await saveProviderKey(provider, apiKeyInput.trim())
      setAvailableModels(models)
      setApiKeyInput('')
      await checkBackendStatus()
      showToast('API key saved securely')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Invalid API key')
    } finally {
      setAiBusy(false)
    }
  }

  const handleRemoveApiKey = async () => {
    setAiBusy(true)
    try {
      await removeProviderKey(provider)
      setAvailableModels([])
      await checkBackendStatus()
      showToast('API key removed')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not remove key')
    } finally {
      setAiBusy(false)
    }
  }

  const handleLoadModels = async () => {
    setAiBusy(true)
    try {
      const models = await listProviderModels(provider)
      setAvailableModels(models)
      showToast(`Loaded ${models.length} models`)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not load models')
    } finally {
      setAiBusy(false)
    }
  }

  const handleUseModel = async () => {
    if (!model.trim()) {
      showToast('Enter a model ID')
      return
    }
    await chrome.storage.local.set({ aiProvider: provider, aiModel: model.trim() })
    setAiModalOpen(false)
    showToast(`Using ${model.replace('models/', '')}`)
  }

  // Filtered notes list on home
  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return sessions.filter((s) => {
      const matchesGroup =
        activeGroupId === 'all'
          ? true
          : activeGroupId === 'none'
          ? (!s.groupId || !groups.some((g) => g.id === s.groupId))
          : s.groupId === activeGroupId
      const matchesSearch = !q || s.videoTitle.toLowerCase().includes(q) || (s.platformName || '').toLowerCase().includes(q)
      return matchesGroup && matchesSearch
    })
  }, [sessions, activeGroupId, searchQuery, groups])

  // Count per group
  const getGroupCount = (gid: string) => {
    if (gid === 'all') return sessions.length
    if (gid === 'none') return sessions.filter((s) => !s.groupId || !groups.some((g) => g.id === s.groupId)).length
    return sessions.filter((s) => s.groupId === gid).length
  }

  const currentGroupObj = groups.find((g) => g.id === activeGroupId)
  const isPillActive = view === 'note' && selectedSession

  return (
    <>
      {/* Detailed Pixel Pond Animated Background */}
      <PondBackground theme={theme} paused={motionPaused} />

      <main className="app">
        {/* Top Header */}
        <header className="top">
          <div className="logo" aria-hidden="true">
            A
          </div>
          <div>
            <h1>AI Video Notes</h1>
            <small>Smart Study Workspace</small>
          </div>

          {/* Status pill (shown in note view) */}
          {isPillActive && (
            <div className={`pill ${selectedSession.status === 'paused' || selectedSession.status === 'completed' ? 'paused' : ''}`}>
              <span className="dot" />
              <span>{selectedSession.status === 'completed' ? 'Finished' : selectedSession.status === 'paused' ? 'Paused' : 'Active'}</span>
            </div>
          )}

          {/* Theme button (Sun/Moon) */}
          <button
            className="ib"
            id="theme"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title="Theme"
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
              </svg>
            )}
          </button>

          {/* Gear button (AI Model Settings) */}
          <button className="ib" id="gear" onClick={() => setAiModalOpen(true)} aria-label="AI model settings" title="AI model">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
              <circle cx="16" cy="7" r="2" />
              <circle cx="8" cy="17" r="2" />
            </svg>
          </button>

          {/* More actions menu */}
          <div className="menu">
            <button
              className="ib"
              id="more"
              onClick={() => setMoreMenuOpen((prev) => !prev)}
              aria-label="More actions"
              aria-haspopup="true"
              aria-expanded={moreMenuOpen}
              title="More"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="5" cy="12" r="1.2" />
                <circle cx="12" cy="12" r="1.2" />
                <circle cx="19" cy="12" r="1.2" />
              </svg>
            </button>
            {moreMenuOpen && (
              <div className="pop" onClick={() => setMoreMenuOpen(false)}>
                <button onClick={handleExportZip}>Export ZIP</button>
                <button onClick={handleCopyDoc}>Copy document</button>
                <button onClick={toggleMotion}>
                  {motionPaused ? '▶ Resume background motion' : '⏸ Pause background motion'}
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Service Alert */}
        {serviceAlert && (
          <div className="alert" role="alert">
            <span>! {serviceAlert}</span>
            <button className="lk" onClick={() => void checkBackendStatus()}>
              Retry
            </button>
            <button className="lk" onClick={() => setServiceAlert(null)} aria-label="Dismiss" style={{ width: 24, height: 24 }}>
              ✕
            </button>
          </div>
        )}

        {/* ===================== HOME VIEW ===================== */}
        {view === 'home' && (
          <section className="scroll" id="home">
            <div className="hhead">
              <h2>Notes</h2>
              <div className="acts">
                <button
                  className="btn"
                  onClick={() => {
                    setEditingGroupId(null)
                    setGroupNameInput('')
                    setGroupModalOpen(true)
                  }}
                >
                  + Group
                </button>
                <button className="btn pri" onClick={handleOpenNewNoteModal}>
                  + New note
                </button>
              </div>
            </div>

            {/* AI Model row */}
            <button className="modelrow" onClick={() => setAiModalOpen(true)} aria-label="Change AI model">
              <span>AI model</span>
              <b>{PROVIDER_NAMES[provider]} · {model.replace('models/', '')}</b>
              <span>Change</span>
            </button>

            {/* Auto-detected Video Card */}
            {currentVideo ? (
              <div className="detected-card">
                <div className="detected-card-top">
                  <span className="badge-platform">{currentVideo.platformName}</span>
                  <span className="detected-card-status">
                    {currentVideo.isAd ? (
                      <span className="status-ad">Ad active · paused</span>
                    ) : currentVideo.isPlaying ? (
                      'Video playing'
                    ) : (
                      'Video detected'
                    )}
                  </span>
                </div>
                <div className="detected-card-title">{currentVideo.videoTitle}</div>
                <div style={{ display: 'flex', gap: 8, width: '100%', marginTop: 2 }}>
                  <button
                    className="btn pri"
                    style={{ flex: 1, minHeight: 36, fontSize: 13 }}
                    onClick={() => void handleStartDetectedVideo()}
                  >
                    ● Start note session
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="btn"
                style={{
                  width: '100%',
                  minHeight: 36,
                  marginBottom: 12,
                  fontSize: 12.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                }}
                onClick={() => void handleConnectCurrentTab()}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                Connect video on active tab
              </button>
            )}

            {/* Search */}
            <input
              className="search"
              type="search"
              placeholder="Search notes"
              aria-label="Search notes"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            {/* Chips bar */}
            <div className="chips" role="group" aria-label="Groups">
              <button
                className="chip"
                aria-pressed={activeGroupId === 'all'}
                onClick={() => {
                  setActiveGroupId('all')
                  setNoteCardMenuId(null)
                }}
              >
                All<em>{getGroupCount('all')}</em>
              </button>
              {groups.map((g) => (
                <button
                  key={g.id}
                  className="chip"
                  aria-pressed={activeGroupId === g.id}
                  onClick={() => {
                    setActiveGroupId((prev) => (prev === g.id ? 'all' : g.id))
                    setNoteCardMenuId(null)
                  }}
                >
                  {g.name}<em>{getGroupCount(g.id)}</em>
                </button>
              ))}
              <button
                className="chip"
                aria-pressed={activeGroupId === 'none'}
                onClick={() => {
                  setActiveGroupId((prev) => (prev === 'none' ? 'all' : 'none'))
                  setNoteCardMenuId(null)
                }}
              >
                Ungrouped<em>{getGroupCount('none')}</em>
              </button>
              <button
                className="chip add"
                onClick={() => {
                  setEditingGroupId(null)
                  setGroupNameInput('')
                  setAssignSessionOnCreateId(null)
                  setGroupModalOpen(true)
                }}
              >
                + Group
              </button>
            </div>

            {/* Selected group action bar */}
            {currentGroupObj && (
              <div className="grow">
                <b>{currentGroupObj.name}</b>
                <button
                  className="btn pri"
                  style={{ minHeight: 28, fontSize: 12, padding: '0 10px' }}
                  onClick={() => {
                    setSelectedNotesToAdd([])
                    setAddNotesSearch('')
                    setAddNotesModalOpen(true)
                  }}
                >
                  + Add notes
                </button>
                <button
                  className="btn"
                  style={{ minHeight: 28, fontSize: 12, padding: '0 10px' }}
                  onClick={() => {
                    setEditingGroupId(currentGroupObj.id)
                    setGroupNameInput(currentGroupObj.name)
                    setGroupModalOpen(true)
                  }}
                >
                  Rename
                </button>
                <button
                  className="btn"
                  style={{ minHeight: 28, fontSize: 12, padding: '0 10px' }}
                  onClick={handleDeleteActiveGroup}
                >
                  Delete
                </button>
              </div>
            )}

            {/* Notes List */}
            <div id="list">
              {filteredSessions.map((session) => {
                const groupName = session.groupId ? groups.find((g) => g.id === session.groupId)?.name : null
                const sessionDate = new Date(session.startedAt).toLocaleDateString('en-US')
                const isCardMenuOpen = noteCardMenuId === session.id
                return (
                  <article
                    key={session.id}
                    className={`nc ${isCardMenuOpen ? 'menu-open' : ''}`}
                    style={isCardMenuOpen ? { zIndex: 60 } : undefined}
                  >
                    <button className="nc-main" onClick={() => openNote(session.id)}>
                      <h3>{session.videoTitle}</h3>
                      <div className="sub">
                        <span>{session.platformName || 'Web video'}</span>
                        <span>{sessionDate}</span>
                        {groupName && <span className="gb">{groupName}</span>}
                        {session.status === 'completed' ? (
                          <span>Finished</span>
                        ) : session.status === 'paused' ? (
                          <span>Paused</span>
                        ) : (
                          <span>Active</span>
                        )}
                      </div>
                      <div className="mini">
                        <b style={{ width: session.status === 'completed' ? '100%' : '45%' }} />
                      </div>
                    </button>

                    <button
                      className="ib"
                      onClick={(e) => {
                        e.stopPropagation()
                        setNoteCardMenuId((prev) => (prev === session.id ? null : session.id))
                      }}
                      aria-label="Note actions"
                      title="Actions"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="5" cy="12" r="1.2" />
                        <circle cx="12" cy="12" r="1.2" />
                        <circle cx="19" cy="12" r="1.2" />
                      </svg>
                    </button>

                    {isCardMenuOpen && (
                      <div className="pop" onClick={(e) => e.stopPropagation()}>
                        {session.status === 'completed' && (
                          <button
                            style={{ fontWeight: 650, color: 'var(--ink)' }}
                            onClick={() => {
                              setNoteCardMenuId(null)
                              void handleReopenSession(session.id)
                            }}
                          >
                            Continue note
                          </button>
                        )}
                        {groups
                          .filter((g) => g.id !== session.groupId)
                          .map((g) => (
                            <button key={g.id} onClick={() => void handleMoveSessionGroup(session.id, g.id)}>
                              Move to {g.name}
                            </button>
                          ))}
                        <button
                          onClick={() => {
                            setEditingGroupId(null)
                            setGroupNameInput('')
                            setAssignSessionOnCreateId(session.id)
                            setGroupModalOpen(true)
                            setNoteCardMenuId(null)
                          }}
                        >
                          + New group…
                        </button>
                        {session.groupId && (
                          <button onClick={() => void handleMoveSessionGroup(session.id, null)}>Remove from group</button>
                        )}
                        <button onClick={() => void handleDeleteSession(session.id)}>Delete note</button>
                      </div>
                    )}
                  </article>
                )
              })}

              {filteredSessions.length === 0 && (
                <div className="empty">
                  {searchQuery ? (
                    'No notes match your search.'
                  ) : currentGroupObj ? (
                    <>
                      No notes in "{currentGroupObj.name}" yet.
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
                        <button
                          className="btn pri"
                          onClick={() => {
                            setSelectedNotesToAdd([])
                            setAddNotesSearch('')
                            setAddNotesModalOpen(true)
                          }}
                        >
                          + Add existing notes
                        </button>
                        <button className="btn" onClick={handleOpenNewNoteModal}>
                          + New note
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      No notes here yet.
                      <br />
                      <button className="btn pri" onClick={handleOpenNewNoteModal}>
                        + New note
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ===================== NOTE VIEW ===================== */}
        {view === 'note' && selectedSession && (
          <div className="scroll" id="noteView">
            <button className="back" onClick={goHome}>
              ← All notes
            </button>

            {/* Hero Section */}
            <section className="hero">
              <div className="meta">
                <span className="tag">{selectedSession.platformName || 'Web video'}</span>
                {currentVideo?.isAd && (
                  <span className="tag-ad">
                    <span className="ad-dot" />
                    Ad active · paused
                  </span>
                )}
                <span>{new Date(selectedSession.startedAt).toLocaleDateString('en-US')}</span>
                <div className="group-select-wrap">
                  <select
                    className={`group-select ${selectedSession.groupId ? 'has-group' : ''}`}
                    value={selectedSession.groupId || ''}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setEditingGroupId(null)
                        setGroupNameInput('')
                        setAssignSessionOnCreateId(selectedSession.id)
                        setGroupModalOpen(true)
                      } else {
                        void handleMoveSessionGroup(selectedSession.id, e.target.value || null)
                      }
                    }}
                    aria-label="Group"
                  >
                    <option value="">No group</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                    <option value="__new__">+ New group…</option>
                  </select>
                  <svg className="group-select-arrow" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </div>

              {/* Title (editable) */}
              {editingTitle ? (
                <input
                  className="title-input"
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => void handleSaveTitle()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSaveTitle()
                    if (e.key === 'Escape') setEditingTitle(false)
                  }}
                />
              ) : (
                <h2
                  className="title"
                  onClick={() => {
                    setTitleDraft(selectedSession.videoTitle)
                    setEditingTitle(true)
                  }}
                >
                  <span>{selectedSession.videoTitle?.trim() || 'Untitled Video'}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.45, flexShrink: 0 }}>
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </h2>
              )}

              {/* Timeline scrubber bar (click to seek) */}
              <div
                className="scrub"
                onClick={(e) => {
                  if (!effectiveDuration) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                  const targetTime = Math.floor(pct * effectiveDuration)
                  handleSeek(targetTime)
                }}
                title="Click to seek video"
              >
                <b style={{ width: `${Math.min(100, (currentTimestamp / (effectiveDuration || 1)) * 100)}%` }} />
                {captures.map((cap) => (
                  <i
                    key={cap.id}
                    style={{ left: `${Math.min(100, (cap.timestampSeconds / (effectiveDuration || 1)) * 100)}%` }}
                    title={`Capture at ${formatTimestamp(cap.timestampSeconds)}`}
                  />
                ))}
              </div>

              <div className="times">
                <span>{formatTimestamp(currentTimestamp)}</span>
                <span>{formatTimestamp(effectiveDuration)}</span>
              </div>

              {/* Controls */}
              <div className={`controls ${selectedSession.status === 'completed' ? 'completed-controls' : ''}`}>
                {selectedSession.status === 'completed' ? (
                  <>
                    <button
                      className="btn pri"
                      style={{ minHeight: 38, padding: '0 16px', fontWeight: 650, flex: '1 1 130px' }}
                      onClick={() => void handleReopenSession(selectedSession.id)}
                    >
                      Continue note
                    </button>
                    <button
                      className="btn"
                      style={{ minHeight: 38, padding: '0 16px', fontWeight: 600, flex: '1 1 130px' }}
                      onClick={() => void handleCaptureNow()}
                      title="Take an instant capture to append to this note"
                    >
                      Capture now
                    </button>
                  </>
                ) : (
                  <>
                    <select
                      className="btn"
                      value={selectedSession.captureIntervalSeconds}
                      onChange={async (e) => {
                        const sec = Number(e.target.value)
                        const updated = { ...selectedSession, captureIntervalSeconds: sec }
                        await saveSession(updated)
                        try {
                          await sendExtensionMessage({ type: 'SET_CAPTURE_INTERVAL', captureIntervalSeconds: sec })
                        } catch {}
                        await refresh(selectedSession.id)
                        showToast(`Capturing every ${sec}s`)
                      }}
                      aria-label="Capture interval"
                    >
                      {intervals.map((s) => (
                        <option key={s} value={s}>
                          {s}s
                        </option>
                      ))}
                    </select>

                    <button
                      className="btn"
                      onClick={() => void handleTogglePause()}
                    >
                      {selectedSession.status === 'paused' ? 'Resume' : 'Pause'}
                    </button>

                    <button
                      className="btn pri"
                      onClick={() => void handleCaptureNow()}
                    >
                      Capture
                    </button>

                    <button className="btn" onClick={() => void handleFinishSession()}>
                      Finish
                    </button>
                  </>
                )}
              </div>

              {/* Stats */}
              <div className="stats">
                <span>
                  <b>{captures.length}</b> captures
                </span>
                <span>
                  <b>{notes.length}</b> notes
                </span>
                <span>
                  <b>{notes.filter((n) => n.userEdited).length}</b> edited
                </span>
              </div>
            </section>

            {/* Segmented Tabs */}
            <div className="seg" role="tablist">
              <button
                role="tab"
                aria-selected={activeTab === 'tl'}
                onClick={() => setActiveTab('tl')}
              >
                Timeline<em>{notes.length}</em>
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'doc'}
                onClick={() => setActiveTab('doc')}
              >
                Document
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'sum'}
                onClick={() => setActiveTab('sum')}
              >
                Summary
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'ask'}
                onClick={() => setActiveTab('ask')}
              >
                Ask AI
                {askProposals.filter((p) => p.sessionId === selectedSession.id && !p.added).length > 0 && (
                  <em className="ask-tab-badge">
                    {askProposals.filter((p) => p.sessionId === selectedSession.id && !p.added).length}
                  </em>
                )}
              </button>
            </div>

            {/* Tab 1: Timeline */}
            {activeTab === 'tl' && (
              <div id="view">
                {notes.length > 0 || captures.some((c) => c.processingStatus === 'pending' || c.processingStatus === 'processing' || c.processingStatus === 'failed') ? (
                  <div className="rail">
                    {/* Render pending/processing/failed captures first if waiting */}
                    {captures
                      .filter(
                        (c) =>
                          (c.processingStatus === 'pending' || c.processingStatus === 'processing' || c.processingStatus === 'failed') &&
                          !notes.some((n) => n.captureId === c.id),
                      )
                      .map((cap) => (
                        <article key={cap.id} className="note" style={{ borderStyle: 'dashed' }}>
                          <div className="nh">
                            <button className="ts" onClick={() => handleSeek(cap.timestampSeconds)} title="Jump to this moment">
                              ▶ {formatTimestamp(cap.timestampSeconds)}
                            </button>
                            <span className="sp" />
                            {cap.processingStatus === 'failed' ? (
                              <button
                                className="btn"
                                style={{ minHeight: 24, padding: '0 8px', fontSize: 11 }}
                                onClick={() => void handleRetryCapture(cap.id)}
                              >
                                Retry
                              </button>
                            ) : (
                              <span className="badge-status processing">
                                <span className="pulsing-dot" /> Generating AI note…
                              </span>
                            )}
                          </div>
                          {cap.transcriptText?.trim() && (
                            <div className="original-talk">
                              <div className="talk-header">
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                </svg>
                                <span>{cap.transcriptText.startsWith('[Visual slide') ? 'Slide Context' : 'Spoken in video'}</span>
                              </div>
                              <p className="talk-body">"{cap.transcriptText}"</p>
                            </div>
                          )}
                          {cap.screenshotDataUrl && (
                            <div className="shot">
                              <img src={cap.screenshotDataUrl} alt="Captured frame" />
                            </div>
                          )}
                          {cap.processingError && (
                            <p style={{ color: 'var(--mute)', fontSize: 12, marginTop: 6 }}>
                              {cap.processingError}
                            </p>
                          )}
                        </article>
                      ))}

                    {/* Render generated notes */}
                    {notes.map((note) => {
                      const matchingCapture =
                        captures.find((c) => c.id === note.captureId) ??
                        captures.find((c) => Math.abs(c.timestampSeconds - note.startTimestampSeconds) <= 10)
                      const screenshot = matchingCapture?.screenshotDataUrl
                      const talkText = matchingCapture?.transcriptText?.trim()
                      return (
                        <article key={note.id} className="note">
                          <div className="nh">
                            <button className="ts" onClick={() => handleSeek(note.startTimestampSeconds)} title="Jump to this moment">
                              ▶ {formatTimestamp(note.startTimestampSeconds)}
                            </button>
                            <span className="sp" />
                            <div className="note-top-actions">
                              <button
                                className="ib"
                                style={{ width: 28, height: 28 }}
                                onClick={() => {
                                  const keyPointsText =
                                    note.keyPoints.length > 0 ? `\n\nKey points:\n${note.keyPoints.map((p) => `- ${p}`).join('\n')}` : ''
                                  const quoteText = talkText ? `\n\nOriginal talk: "${talkText}"` : ''
                                  const fullText = `${formatTimestamp(note.startTimestampSeconds)} - ${note.title}\n\n${note.explanation}${keyPointsText}${quoteText}`
                                  void navigator.clipboard.writeText(fullText)
                                  showToast('Note copied to clipboard')
                                }}
                                aria-label="Copy note"
                                title="Copy note text"
                              >
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                              </button>
                              <button
                                className="ib"
                                style={{ width: 28, height: 28 }}
                                onClick={() => void handleDeleteNote(note.id)}
                                aria-label="Delete note"
                                title="Delete"
                              >
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
                                </svg>
                              </button>
                            </div>
                          </div>
                          <h3>{note.title}</h3>
                          <p>{note.explanation}</p>
                          {note.keyPoints.length > 0 && (
                            <ul>
                              {note.keyPoints.map((pt, i) => (
                                <li key={i}>{pt}</li>
                              ))}
                            </ul>
                          )}
                          {/* Original talk / speech from video */}
                          {talkText && (
                            <div className="original-talk">
                              <div className="talk-header">
                                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                </svg>
                                <span>{talkText.startsWith('[Visual slide') ? 'Slide Context' : 'Original talk from video'}</span>
                              </div>
                              <p className="talk-body">"{talkText}"</p>
                            </div>
                          )}
                          {screenshot && (
                            <>
                              <div className="shot">
                                <img src={screenshot} alt={note.title} />
                              </div>
                              <div className="nh" style={{ margin: '10px 0 0' }}>
                                <span className="ts">{formatTimestamp(note.startTimestampSeconds)}</span>
                                <span className="ok">✓ Screenshot saved</span>
                              </div>
                            </>
                          )}
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <div className="card">
                    <h3>No notes yet</h3>
                    <p>Press Capture or add a quick note below.</p>
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Document (interactive & editable markdown) */}
            {activeTab === 'doc' && (
              <div id="view">
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button className="btn" onClick={handleCopyDoc}>
                    Copy markdown
                  </button>
                  <button className="btn pri" onClick={handleExportZip}>
                    Export ZIP
                  </button>
                  {docEdited && (
                    <button
                      className="btn"
                      onClick={() => {
                        if (selectedSession) {
                          setDocCustomText(compileMarkdown(selectedSession, notes, captures))
                          setDocEdited(false)
                          showToast('Reset to generated notes')
                        }
                      }}
                    >
                      Reset edits
                    </button>
                  )}
                </div>
                <textarea
                  className="doc-editor"
                  value={docCustomText}
                  onChange={(e) => {
                    setDocCustomText(e.target.value)
                    setDocEdited(true)
                  }}
                  placeholder="Notes document in markdown..."
                  rows={18}
                />
              </div>
            )}

            {/* Tab 3: Summary */}
            {activeTab === 'sum' && (
              <div id="view">
                {selectedSession.summary ? (
                  <div className="card" style={{ textAlign: 'left' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h3 style={{ margin: 0 }}>Review guide</h3>
                      <button className="btn" disabled={isSummarizing} onClick={handleGenerateSummary}>
                        {isSummarizing ? 'Updating…' : 'Regenerate summary'}
                      </button>
                    </div>
                    <pre style={{ background: 'transparent', border: 0, padding: 0 }}>{selectedSession.summary}</pre>
                  </div>
                ) : (
                  <div className="card">
                    <h3>No summary yet</h3>
                    <p>
                      Turn your notes into an executive review guide with themes and review quiz.
                      <br />
                      Model: {model.replace('models/', '')}
                    </p>
                    <button className="btn pri" disabled={isSummarizing || notes.length === 0} onClick={handleGenerateSummary}>
                      {isSummarizing ? 'Generating…' : `Generate from ${notes.length} notes`}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Tab 4: Ask AI */}
            {activeTab === 'ask' && (
              <div id="view" className="ask-tab-view">
                <div className="ask-card">
                  <div className="ask-header">
                    <div className="ask-title-wrap">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--pri)', flexShrink: 0 }}>
                        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" />
                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      <div>
                        <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 650 }}>Ask AI to Enrich Notes</h3>
                        <p className="ask-sub">
                          Add specific technical topics, comparisons, or deep dives—even if not in the video. Once approved, it is added to your full notes and review summary.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Ask Form */}
                  <form className="ask-form" onSubmit={handleAskAi}>
                    <textarea
                      className="ask-textarea"
                      placeholder="Ask AI anything to supplement this note (e.g., 'Compare thread system of Java and Go', 'Explain memory management tradeoffs')..."
                      rows={3}
                      value={askPrompt}
                      onChange={(e) => setAskPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          void handleAskAi()
                        }
                      }}
                    />
                    <div className="ask-form-actions">
                      <label className="ask-checkbox-label">
                        <input
                          type="checkbox"
                          checked={askAutoUpdateSummary}
                          onChange={(e) => setAskAutoUpdateSummary(e.target.checked)}
                        />
                        <span>Also update review summary when approved</span>
                      </label>
                      <button
                        type="submit"
                        className="btn pri"
                        disabled={isAskingAi || !askPrompt.trim()}
                        style={{ minHeight: 34, padding: '0 18px', fontWeight: 650 }}
                      >
                        {isAskingAi ? 'Generating…' : 'Ask AI'}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Proposals Feed */}
                <div className="ask-proposals">
                  {askProposals
                    .filter((p) => p.sessionId === selectedSession.id)
                    .map((proposal) => (
                      <article key={proposal.id} className={`ask-proposal-card ${proposal.added ? 'is-added' : ''}`}>
                        <div className="ask-proposal-top">
                          <div className="ask-proposal-meta">
                            {proposal.added ? (
                              <span className="ask-badge added">
                                <svg className="badge-icon" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                                Added to notes
                              </span>
                            ) : (
                              <span className="ask-badge pending">
                                <span className="badge-dot" />
                                AI proposal
                              </span>
                            )}
                            <span className="ask-prompt-quote" title={proposal.prompt}>"{proposal.prompt}"</span>
                          </div>
                          <button
                            className="ask-dismiss-btn"
                            onClick={() => handleDismissProposal(proposal.id)}
                            title="Remove proposal"
                            aria-label="Remove proposal"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>

                        <h4 className="ask-proposal-title">{proposal.title}</h4>
                        <p className="ask-proposal-explanation">{proposal.explanation}</p>

                        {proposal.keyPoints && proposal.keyPoints.length > 0 && (
                          <ul className="ask-proposal-points">
                            {proposal.keyPoints.map((point, idx) => (
                              <li key={idx}>{point}</li>
                            ))}
                          </ul>
                        )}

                        <div className="ask-proposal-footer">
                          <div className="ask-footer-info">
                            <span>At {formatTimestamp(proposal.timestampSeconds)}</span>
                          </div>
                          <div className="ask-footer-actions">
                            {proposal.added ? (
                              <>
                                <button
                                  className="btn"
                                  style={{ minHeight: 28, padding: '0 12px', fontSize: 11.5 }}
                                  onClick={() => setActiveTab('tl')}
                                >
                                  View in Timeline
                                </button>
                                <button
                                  className="btn"
                                  style={{ minHeight: 28, padding: '0 12px', fontSize: 11.5 }}
                                  onClick={() => setActiveTab('sum')}
                                >
                                  View in Summary
                                </button>
                              </>
                            ) : (
                              <button
                                className="ask-approve-btn"
                                onClick={() => void handleApproveProposal(proposal.id)}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                                <span>Approve & add to notes</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    ))}

                  {askProposals.filter((p) => p.sessionId === selectedSession.id).length === 0 && !isAskingAi && (
                    <div className="empty" style={{ margin: '16px 0', padding: '36px 16px' }}>
                      <p style={{ margin: 0, fontWeight: 600, color: 'var(--ink)' }}>No extra AI notes yet</p>
                      <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--mute)' }}>
                        Type your question above or click a suggestion chip to generate custom concepts, comparisons, and technical deep dives.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Docked Quick Note Form (Note View) */}
        {view === 'note' && selectedSession && activeTab !== 'ask' && (
          <form className="dock" onSubmit={handleAddQuickNote}>
            <input
              placeholder="Add a quick note"
              aria-label="Quick note"
              value={quickNoteText}
              onChange={(e) => setQuickNoteText(e.target.value)}
            />
            <button className="btn pri" disabled={!quickNoteText.trim()}>
              Add
            </button>
          </form>
        )}
      </main>

      {/* ===================== MODAL: AI MODEL ===================== */}
      {aiModalOpen && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mt1" onClick={() => setAiModalOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2 id="mt1">AI model</h2>
            <p className="n">Keys are stored in Windows Credential Manager on this device and never shown again.</p>

            <label htmlFor="prov">Provider</label>
            <select
              id="prov"
              value={provider}
              onChange={(e) => {
                const nextP = e.target.value as AiProvider
                setProvider(nextP)
                setModel(PROVIDER_DEFAULTS[nextP])
              }}
            >
              <option value="GEMINI">Google Gemini</option>
              <option value="OPENAI">OpenAI</option>
              <option value="ANTHROPIC">Anthropic Claude</option>
            </select>

            <label htmlFor="key">Replace API key</label>
            <div className="f">
              <input
                id="key"
                type="password"
                placeholder={providersStatus.find((p) => p.id === provider)?.configured ? 'Key saved ✓' : 'Enter API key'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                disabled={aiBusy}
              />
              <button className="btn pri" type="button" disabled={aiBusy || !apiKeyInput.trim()} onClick={handleSaveApiKey}>
                Save
              </button>
              {providersStatus.find((p) => p.id === provider)?.configured && (
                <button className="btn" type="button" disabled={aiBusy} onClick={handleRemoveApiKey}>
                  Remove
                </button>
              )}
            </div>

            <label htmlFor="mid">Model ID</label>
            <div className="f">
              <input
                id="mid"
                list="mlist"
                autoComplete="off"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={aiBusy}
              />
              <datalist id="mlist">
                {(availableModels.length > 0 ? availableModels : SUGGESTED_MODELS[provider] || []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <button className="btn" type="button" disabled={aiBusy} onClick={handleLoadModels}>
                Load models
              </button>
            </div>

            <div className="f" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn" type="button" onClick={() => setAiModalOpen(false)}>
                Cancel
              </button>
              <button className="btn pri" type="button" disabled={aiBusy || !model.trim()} onClick={handleUseModel}>
                Use model
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL: NEW NOTE ===================== */}
      {newNoteModalOpen && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mt2" onClick={() => setNewNoteModalOpen(false)}>
          <form className="sheet" onSubmit={handleCreateNote} onClick={(e) => e.stopPropagation()}>
            <h2 id="mt2">New note</h2>
            {currentVideo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--mute)', margin: '4px 0 10px' }}>
                <span className="tag" style={{ fontSize: 10, padding: '1px 6px' }}>{currentVideo.platformName}</span>
                <span>Auto-detected from active video tab</span>
              </div>
            )}

            <label htmlFor="nnTitle">Title</label>
            <input
              id="nnTitle"
              required
              placeholder="What are you learning?"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              style={{ width: '100%', minHeight: 40, border: '1px solid var(--line)', background: 'var(--bg)', borderRadius: 10, padding: '0 12px' }}
            />

            <label htmlFor="nnUrl">Video link (optional)</label>
            <input
              id="nnUrl"
              placeholder="https://"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              style={{ width: '100%', minHeight: 40, border: '1px solid var(--line)', background: 'var(--bg)', borderRadius: 10, padding: '0 12px' }}
            />

            <label htmlFor="nnGroup">Group</label>
            <select
              id="nnGroup"
              value={newGroupId}
              onChange={(e) => setNewGroupId(e.target.value)}
              style={{ width: '100%', minHeight: 40, border: '1px solid var(--line)', background: 'var(--bg)', borderRadius: 10, padding: '0 12px' }}
            >
              <option value="">No group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>

            <div className="f" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn" type="button" onClick={() => setNewNoteModalOpen(false)}>
                Cancel
              </button>
              <button className="btn pri" type="submit">
                Create note
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================== MODAL: NEW / RENAME GROUP ===================== */}
      {groupModalOpen && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mt3" onClick={() => setGroupModalOpen(false)}>
          <form className="sheet" onSubmit={handleSaveGroup} onClick={(e) => e.stopPropagation()}>
            <h2 id="mt3">{editingGroupId ? 'Rename group' : 'New group'}</h2>

            <label htmlFor="gName">Group name</label>
            <input
              id="gName"
              required
              maxLength={40}
              placeholder="e.g. Cloud, Math, Interview prep"
              value={groupNameInput}
              onChange={(e) => setGroupNameInput(e.target.value)}
              style={{ width: '100%', minHeight: 40, border: '1px solid var(--line)', background: 'var(--bg)', borderRadius: 10, padding: '0 12px' }}
            />

            <div className="f" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
              <button className="btn" type="button" onClick={() => setGroupModalOpen(false)}>
                Cancel
              </button>
              <button className="btn pri" type="submit">
                {editingGroupId ? 'Save' : 'Create group'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================== MODAL: ADD EXISTING NOTES TO GROUP ===================== */}
      {addNotesModalOpen && currentGroupObj && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mtAddNotes"
          onClick={() => setAddNotesModalOpen(false)}
        >
          <form className="sheet" onSubmit={handleBatchAddNotesToGroup} onClick={(e) => e.stopPropagation()}>
            <h2 id="mtAddNotes">Add notes to {currentGroupObj.name}</h2>
            <p className="n">Choose existing notes to add into this group.</p>

            <input
              className="search"
              type="search"
              placeholder="Search notes to add..."
              aria-label="Filter notes"
              value={addNotesSearch}
              onChange={(e) => setAddNotesSearch(e.target.value)}
              style={{ width: '100%', minHeight: 38, margin: '8px 0 10px' }}
            />

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn"
                style={{ minHeight: 28, fontSize: 11.5, padding: '0 8px' }}
                onClick={() => {
                  const eligible = sessions
                    .filter((s) => s.groupId !== currentGroupObj.id)
                    .filter((s) => !s.groupId || !groups.some((g) => g.id === s.groupId))
                    .map((s) => s.id)
                  setSelectedNotesToAdd(eligible)
                }}
              >
                Select all ungrouped
              </button>

              <button
                type="button"
                className="btn"
                style={{ minHeight: 28, fontSize: 11.5, padding: '0 8px' }}
                onClick={() => {
                  const eligible = sessions.filter((s) => s.groupId !== currentGroupObj.id).map((s) => s.id)
                  if (selectedNotesToAdd.length === eligible.length) {
                    setSelectedNotesToAdd([])
                  } else {
                    setSelectedNotesToAdd(eligible)
                  }
                }}
              >
                {selectedNotesToAdd.length > 0 ? 'Deselect all' : 'Select all'}
              </button>
            </div>

            <div className="note-select-list">
              {sessions
                .filter((s) => s.groupId !== currentGroupObj.id)
                .filter((s) => !addNotesSearch || s.videoTitle.toLowerCase().includes(addNotesSearch.toLowerCase()))
                .map((s) => {
                  const isChecked = selectedNotesToAdd.includes(s.id)
                  const sessionDate = new Date(s.startedAt).toLocaleDateString('en-US')
                  const currGroupName = s.groupId ? groups.find((g) => g.id === s.groupId)?.name : null
                  return (
                    <label key={s.id} className="note-select-item">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          setSelectedNotesToAdd((prev) =>
                            isChecked ? prev.filter((id) => id !== s.id) : [...prev, s.id],
                          )
                        }}
                      />
                      <div className="note-select-info">
                        <div className="note-select-title">{s.videoTitle}</div>
                        <div className="note-select-sub">
                          <span>{s.platformName || 'Web video'}</span>
                          <span>·</span>
                          <span>{sessionDate}</span>
                          {currGroupName ? (
                            <span className="gb" style={{ marginLeft: 4 }}>
                              {currGroupName}
                            </span>
                          ) : (
                            <span style={{ opacity: 0.6 }}>· Ungrouped</span>
                          )}
                        </div>
                      </div>
                    </label>
                  )
                })}
              {sessions.filter((s) => s.groupId !== currentGroupObj.id).length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--mute)', fontSize: 13 }}>
                  All your notes are already in this group!
                </div>
              )}
            </div>

            <div className="f" style={{ marginTop: 16, justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" type="button" onClick={() => setAddNotesModalOpen(false)}>
                Cancel
              </button>
              <button className="btn pri" type="submit" disabled={selectedNotesToAdd.length === 0}>
                Add {selectedNotesToAdd.length > 0 ? `${selectedNotesToAdd.length} ` : ''}notes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================== TOAST ===================== */}
      {toastMessage && (
        <div id="toast" role="status" aria-live="polite">
          <span>{toastMessage}</span>
          {toastUndo && (
            <button
              onClick={() => {
                toastUndo()
                setToastMessage(null)
                setToastUndo(null)
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </>
  )
}
