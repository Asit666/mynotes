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
  listAllNotes,
  listCaptures,
  listGroups,
  listNotes,
  listSearchableCaptures,
  listSessions,
  saveGroup as storageSaveGroup,
  saveNote as storageSaveNote,
  saveSession,
  type SearchableCapture,
} from './storage'

export type SearchMatchKind = 'explanation' | 'keypoint' | 'transcript' | 'slide' | 'note-title' | 'summary'

export interface SessionSearchMatch {
  id: string
  sessionId: string
  timestampSeconds: number
  kind: SearchMatchKind
  snippet: string
  noteId?: string
}

function extractSnippet(text: string, query: string, maxLength = 110): string {
  if (!text) return ''
  const clean = text.replace(/^\[Visual slide:?\s*/i, '').replace(/\]$/, '').trim()
  const lowerText = clean.toLowerCase()
  const lowerQ = query.toLowerCase()
  const idx = lowerText.indexOf(lowerQ)
  if (idx === -1) {
    return clean.length > maxLength ? clean.slice(0, maxLength) + '…' : clean
  }
  const start = Math.max(0, idx - 30)
  const end = Math.min(clean.length, idx + query.length + 50)
  let snippet = clean.slice(start, end).trim()
  if (start > 0) snippet = '…' + snippet
  if (end < clean.length) snippet = snippet + '…'
  return snippet
}

function HighlightSnippet({ text, query }: { text: string; query: string }) {
  if (!query || !query.trim() || !text) return <span>{text}</span>
  const q = query.trim()
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(regex)
  return (
    <span>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="search-highlight">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  )
}

function formatMatchKind(kind: SearchMatchKind): string {
  switch (kind) {
    case 'note-title':
      return 'Title'
    case 'explanation':
      return 'Explanation'
    case 'keypoint':
      return 'Key Point'
    case 'slide':
      return 'Slide'
    case 'transcript':
      return 'Transcript'
    case 'summary':
      return 'Summary'
    default:
      return 'Note'
  }
}

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatInline(text: string): string {
  let res = escapeHtml(text)
  res = res.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  res = res.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
  res = res.replace(/`([^`]+)`/g, '<code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; font-family: monospace;">$1</code>')
  res = res.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  return res
}

function markdownToHtml(markdown: string, captures: VideoCapture[]): string {
  const assetMap = new Map<string, string>()
  for (const c of captures) {
    if (c.screenshotDataUrl) {
      const formattedTs = formatTimestamp(c.timestampSeconds).replace(':', '-')
      assetMap.set(`assets/capture-${formattedTs}-${c.id}.jpg`, c.screenshotDataUrl)
      assetMap.set(c.id, c.screenshotDataUrl)
    }
  }

  const lines = markdown.split('\n')
  const htmlParts: string[] = []
  let inList = false

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const line = rawLine.trim()

    if (!line) {
      if (inList) {
        htmlParts.push('</ul>')
        inList = false
      }
      continue
    }

    if (line === '---' || line === '***') {
      if (inList) {
        htmlParts.push('</ul>')
        inList = false
      }
      htmlParts.push('<hr style="margin: 24px 0; border: none; border-top: 1px solid #e2e8f0;" />')
      continue
    }

    if (line.startsWith('# ')) {
      if (inList) {
        htmlParts.push('</ul>')
        inList = false
      }
      htmlParts.push(`<h1 style="font-size: 24px; font-weight: 700; margin: 24px 0 12px 0;">${formatInline(line.slice(2))}</h1>`)
      continue
    }
    if (line.startsWith('## ')) {
      if (inList) {
        htmlParts.push('</ul>')
        inList = false
      }
      htmlParts.push(`<h2 style="font-size: 20px; font-weight: 600; margin: 20px 0 10px 0;">${formatInline(line.slice(3))}</h2>`)
      continue
    }
    if (line.startsWith('### ')) {
      if (inList) {
        htmlParts.push('</ul>')
        inList = false
      }
      htmlParts.push(`<h3 style="font-size: 16px; font-weight: 600; margin: 16px 0 8px 0;">${formatInline(line.slice(4))}</h3>`)
      continue
    }
    if (line.startsWith('#### ')) {
      if (inList) {
        htmlParts.push('</ul>')
        inList = false
      }
      htmlParts.push(`<h4 style="font-size: 14px; font-weight: 600; margin: 12px 0 6px 0;">${formatInline(line.slice(5))}</h4>`)
      continue
    }

    const imgMatch = line.match(/^!\[(.*?)\]\((.*?)\)$/)
    if (imgMatch) {
      if (inList) {
        htmlParts.push('</ul>')
        inList = false
      }
      const alt = imgMatch[1]
      let src = imgMatch[2]
      if (assetMap.has(src)) {
        src = assetMap.get(src)!
      } else {
        for (const [key, dataUrl] of assetMap.entries()) {
          if (src.includes(key)) {
            src = dataUrl
            break
          }
        }
      }
      htmlParts.push(`<p style="margin: 16px 0;"><img src="${src}" alt="${escapeHtml(alt)}" style="max-width: 100%; height: auto; border-radius: 8px; border: 1px solid #e2e8f0; display: block;" /></p>`)
      continue
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) {
        htmlParts.push('<ul style="margin: 8px 0 16px 20px; padding: 0;">')
        inList = true
      }
      htmlParts.push(`<li style="margin-bottom: 6px;">${formatInline(line.slice(2))}</li>`)
      continue
    }

    if (inList) {
      htmlParts.push('</ul>')
      inList = false
    }

    htmlParts.push(`<p style="margin: 8px 0 12px 0; line-height: 1.6;">${formatInline(line)}</p>`)
  }

  if (inList) {
    htmlParts.push('</ul>')
  }

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b;">${htmlParts.join('\n')}</div>`
}

function compileRichHtml(
  session: LearningSession,
  notes: GeneratedNote[],
  captures: VideoCapture[],
): string {
  const screenshotDataUrls = new Map(
    captures
      .filter((capture) => capture.screenshotDataUrl)
      .map((capture) => [capture.id, capture.screenshotDataUrl!]),
  )

  const summarySectionHtml = session.summary
    ? `
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 12px 0; color: #0f172a;">Executive Summary &amp; Study Overview</h2>
        ${markdownToHtml(session.summary, captures)}
      </div>
      <hr style="margin: 24px 0; border: none; border-top: 1px solid #e2e8f0;" />
    `
    : ''

  const noteSectionsHtml = notes
    .map((note) => {
      let screenshotUrl = note.captureId ? screenshotDataUrls.get(note.captureId) : undefined
      if (!screenshotUrl) {
        const fallback = captures.find(
          (c) => c.screenshotDataUrl && Math.abs(c.timestampSeconds - note.startTimestampSeconds) <= 2,
        )
        screenshotUrl = fallback?.screenshotDataUrl
      }

      const keyPointsHtml =
        note.keyPoints.length > 0
          ? `
            <h3 style="font-size: 15px; font-weight: 600; margin: 12px 0 6px 0; color: #334155;">Key points</h3>
            <ul style="margin: 6px 0 12px 20px; padding: 0;">
              ${note.keyPoints.map((point) => `<li style="margin-bottom: 4px;">${formatInline(point)}</li>`).join('')}
            </ul>
          `
          : ''

      const imageHtml = screenshotUrl
        ? `
          <div style="margin: 16px 0;">
            <img src="${screenshotUrl}" alt="Video frame at ${formatTimestamp(note.startTimestampSeconds)}" style="max-width: 100%; height: auto; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.05); display: block;" />
          </div>
        `
        : ''

      return `
        <div style="margin-bottom: 28px;">
          <h2 style="font-size: 18px; font-weight: 600; margin: 20px 0 8px 0; color: #0f172a;">
            ${formatTimestamp(note.startTimestampSeconds)} — ${escapeHtml(note.title)}
          </h2>
          <p style="margin: 6px 0 10px 0; line-height: 1.6; color: #334155;">${escapeHtml(note.explanation)}</p>
          ${keyPointsHtml}
          ${imageHtml}
        </div>
      `
    })
    .join('')

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 800px;">
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 8px 0; color: #0f172a;">${escapeHtml(session.videoTitle)}</h1>
      <p style="margin: 4px 0 16px 0; font-size: 14px; color: #64748b;">
        <strong>Source:</strong> <a href="${escapeHtml(session.videoUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(session.videoUrl)}</a><br />
        ${session.platformName ? `<strong>Platform:</strong> ${escapeHtml(session.platformName)}<br />` : ''}
        <em>Captured on ${new Date(session.startedAt).toLocaleString()}</em>
      </p>
      <hr style="margin: 20px 0; border: none; border-top: 1px solid #e2e8f0;" />
      ${summarySectionHtml}
      ${noteSectionsHtml}
    </div>
  `
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

function formatTimeAgo(timestampMs: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000))
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ago`
}

function parseTimestampToSeconds(ts: string): number | null {
  if (!ts) return null
  const clean = ts.trim().replace(/^[▶\s]+/, '')
  const parts = clean.split(':').map(Number)
  if (parts.some((n) => isNaN(n) || !isFinite(n))) return null
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1]
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  return null
}

function renderInline(
  text: string,
  assetMap: Map<string, string>,
  onSeek?: (ts: number) => void,
  keyPrefix = 'inline',
): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let remaining = text
  let counter = 0

  while (remaining.length > 0) {
    // 1. Image: ![alt](url)
    const imgMatch = remaining.match(/^!\[(.*?)\]\((.*?)\)/)
    if (imgMatch) {
      const alt = imgMatch[1]
      const rawUrl = imgMatch[2]
      let resolved = assetMap.get(rawUrl) || rawUrl
      if (!assetMap.has(rawUrl)) {
        for (const [k, v] of assetMap) {
          if (rawUrl.includes(k) || k.includes(rawUrl)) {
            resolved = v
            break
          }
        }
      }
      nodes.push(
        <img
          key={`${keyPrefix}-img-${counter++}`}
          src={resolved}
          alt={alt}
          className="doc-preview-inline-img"
          style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--line)', margin: '8px 0', display: 'block' }}
        />,
      )
      remaining = remaining.slice(imgMatch[0].length)
      continue
    }

    // 2. Link: [label](url)
    const linkMatch = remaining.match(/^\[(.*?)\]\((.*?)\)/)
    if (linkMatch) {
      const label = linkMatch[1]
      const url = linkMatch[2]
      const ts = parseTimestampToSeconds(label)
      if (ts !== null && onSeek) {
        nodes.push(
          <button
            key={`${keyPrefix}-ts-${counter++}`}
            className="ts"
            onClick={() => onSeek(ts)}
            title={`Seek video to ${label}`}
            style={{ display: 'inline-flex', verticalAlign: 'middle', margin: '0 4px' }}
          >
            ▶ {label.replace(/^[▶\s]+/, '')}
          </button>,
        )
      } else {
        nodes.push(
          <a
            key={`${keyPrefix}-a-${counter++}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="doc-preview-link"
          >
            {label}
          </a>,
        )
      }
      remaining = remaining.slice(linkMatch[0].length)
      continue
    }

    // 3. Inline code: `code`
    const codeMatch = remaining.match(/^`([^`]+)`/)
    if (codeMatch) {
      nodes.push(
        <code key={`${keyPrefix}-code-${counter++}`} className="doc-preview-code">
          {codeMatch[1]}
        </code>,
      )
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    // 4. Bold: **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/)
    if (boldMatch) {
      nodes.push(
        <strong key={`${keyPrefix}-b-${counter++}`}>
          {renderInline(boldMatch[1], assetMap, onSeek, `${keyPrefix}-b-${counter}`)}
        </strong>,
      )
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    // 5. Italic: *text*
    const italicMatch = remaining.match(/^\*([^*]+)\*/)
    if (italicMatch) {
      nodes.push(
        <em key={`${keyPrefix}-i-${counter++}`}>
          {renderInline(italicMatch[1], assetMap, onSeek, `${keyPrefix}-i-${counter}`)}
        </em>,
      )
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }

    // 6. Strikethrough: ~~text~~
    const strikeMatch = remaining.match(/^~~([^~]+)~~/)
    if (strikeMatch) {
      nodes.push(
        <del key={`${keyPrefix}-del-${counter++}`}>
          {strikeMatch[1]}
        </del>,
      )
      remaining = remaining.slice(strikeMatch[0].length)
      continue
    }

    // Next special character
    const nextSpecial = remaining.search(/[!\[`*~]/)
    if (nextSpecial === -1) {
      nodes.push(remaining)
      break
    } else if (nextSpecial === 0) {
      nodes.push(remaining[0])
      remaining = remaining.slice(1)
    } else {
      nodes.push(remaining.slice(0, nextSpecial))
      remaining = remaining.slice(nextSpecial)
    }
  }

  return nodes
}

interface MarkdownPreviewProps {
  markdown: string
  captures: VideoCapture[]
  onSeek: (seconds: number) => void
  onImageClick?: (src: string) => void
}

function MarkdownPreview({ markdown, captures, onSeek, onImageClick }: MarkdownPreviewProps) {
  const assetMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of captures) {
      if (c.screenshotDataUrl) {
        const formattedTs = formatTimestamp(c.timestampSeconds).replace(':', '-')
        map.set(`assets/capture-${formattedTs}-${c.id}.jpg`, c.screenshotDataUrl)
        map.set(c.id, c.screenshotDataUrl)
        map.set(`capture-${c.id}`, c.screenshotDataUrl)
      }
    }
    return map
  }, [captures])

  const resolveImageSrc = (src: string): string => {
    if (assetMap.has(src)) return assetMap.get(src)!
    for (const [k, v] of assetMap) {
      if (src.includes(k) || k.includes(src)) return v
    }
    return src
  }

  const blocks = useMemo(() => {
    const lines = markdown.split('\n')
    const result: React.ReactNode[] = []
    let i = 0

    while (i < lines.length) {
      const line = lines[i]
      const trimmed = line.trim()

      if (!trimmed) {
        i++
        continue
      }

      // 1. Fenced Code Block
      if (trimmed.startsWith('```')) {
        const lang = trimmed.slice(3).trim()
        const codeLines: string[] = []
        i++
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i])
          i++
        }
        if (i < lines.length) i++
        const codeText = codeLines.join('\n')
        result.push(
          <div key={`code-${i}`} className="doc-code-block">
            <div className="doc-code-header">
              <span>{lang || 'code'}</span>
              <button
                className="doc-copy-code-btn"
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(codeText)
                }}
              >
                Copy
              </button>
            </div>
            <pre>
              <code>{codeText}</code>
            </pre>
          </div>,
        )
        continue
      }

      // 2. Headings
      if (trimmed.startsWith('# ') || trimmed === '#') {
        result.push(
          <h1 key={`h1-${i}`}>
            {renderInline(trimmed.slice(2).trim(), assetMap, onSeek, `h1-${i}`)}
          </h1>,
        )
        i++
        continue
      }

      if (trimmed.startsWith('## ') || trimmed === '##') {
        const headingText = trimmed.slice(3).trim()
        const tsMatch = headingText.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s*[—\-]\s*(.*)$/)
        if (tsMatch) {
          const tsSeconds = parseTimestampToSeconds(tsMatch[1])
          result.push(
            <h2 key={`h2-${i}`}>
              {tsSeconds !== null && (
                <button
                  className="ts"
                  type="button"
                  onClick={() => onSeek(tsSeconds)}
                  title={`Seek video to ${tsMatch[1]}`}
                >
                  ▶ {tsMatch[1]}
                </button>
              )}
              <span>{renderInline(tsMatch[2], assetMap, onSeek, `h2-${i}`)}</span>
            </h2>,
          )
        } else {
          result.push(
            <h2 key={`h2-${i}`}>
              {renderInline(headingText, assetMap, onSeek, `h2-${i}`)}
            </h2>,
          )
        }
        i++
        continue
      }

      if (trimmed.startsWith('### ') || trimmed === '###') {
        result.push(
          <h3 key={`h3-${i}`}>
            {renderInline(trimmed.slice(4).trim(), assetMap, onSeek, `h3-${i}`)}
          </h3>,
        )
        i++
        continue
      }

      if (trimmed.startsWith('#### ') || trimmed === '####') {
        result.push(
          <h4 key={`h4-${i}`}>
            {renderInline(trimmed.slice(5).trim(), assetMap, onSeek, `h4-${i}`)}
          </h4>,
        )
        i++
        continue
      }

      // 3. Horizontal Rule
      if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
        result.push(<hr key={`hr-${i}`} className="doc-hr" />)
        i++
        continue
      }

      // 4. Standalone Image: ![alt](src)
      const imgMatch = trimmed.match(/^!\[(.*?)\]\((.*?)\)$/)
      if (imgMatch) {
        const alt = imgMatch[1]
        const src = resolveImageSrc(imgMatch[2])
        result.push(
          <figure key={`fig-${i}`} className="doc-figure">
            <img
              src={src}
              alt={alt}
              className="doc-figure-img"
              onClick={() => onImageClick?.(src)}
              title="Click to enlarge"
            />
            {alt && <figcaption className="doc-figcaption">{alt}</figcaption>}
          </figure>,
        )
        i++
        continue
      }

      // 5. Blockquote: > text
      if (trimmed.startsWith('>')) {
        const quoteLines: string[] = []
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          quoteLines.push(lines[i].trim().replace(/^>\s*/, ''))
          i++
        }
        result.push(
          <blockquote key={`bq-${i}`}>
            <p>{renderInline(quoteLines.join(' '), assetMap, onSeek, `bq-${i}`)}</p>
          </blockquote>,
        )
        continue
      }

      // 6. Tables
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const tableLines: string[] = []
        while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
          tableLines.push(lines[i].trim())
          i++
        }
        if (tableLines.length >= 2) {
          const parseRow = (r: string) =>
            r
              .slice(1, -1)
              .split('|')
              .map((c) => c.trim())
          const headerCells = parseRow(tableLines[0])
          const isDivider = (r: string) => parseRow(r).every((c) => /^:?-+:?$/.test(c))
          const hasDivider = isDivider(tableLines[1])
          const bodyRows = (hasDivider ? tableLines.slice(2) : tableLines.slice(1)).map(parseRow)

          result.push(
            <div key={`tbl-${i}`} className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr>
                    {headerCells.map((h, cIdx) => (
                      <th key={cIdx}>{renderInline(h, assetMap, onSeek, `th-${i}-${cIdx}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bodyRows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx}>{renderInline(cell, assetMap, onSeek, `td-${i}-${rIdx}-${cIdx}`)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>,
          )
          continue
        }
      }

      // 7. Lists (Bullet, Task, Numbered)
      const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ')
      const isNumbered = /^\d+\.\s/.test(trimmed)
      if (isBullet || isNumbered) {
        const listItems: Array<{ isTask?: boolean; checked?: boolean; text: string }> = []
        while (i < lines.length) {
          const curTrimmed = lines[i].trim()
          if (!curTrimmed) break
          if (curTrimmed.startsWith('- ') || curTrimmed.startsWith('* ')) {
            const itemContent = curTrimmed.slice(2).trim()
            const taskMatch = itemContent.match(/^\[([ xX])\]\s*(.*)$/)
            if (taskMatch) {
              listItems.push({
                isTask: true,
                checked: taskMatch[1].toLowerCase() === 'x',
                text: taskMatch[2],
              })
            } else {
              listItems.push({ text: itemContent })
            }
            i++
          } else if (/^\d+\.\s/.test(curTrimmed)) {
            const itemContent = curTrimmed.replace(/^\d+\.\s*/, '').trim()
            listItems.push({ text: itemContent })
            i++
          } else {
            break
          }
        }

        if (isNumbered) {
          result.push(
            <ol key={`ol-${i}`}>
              {listItems.map((item, idx) => (
                <li key={idx}>{renderInline(item.text, assetMap, onSeek, `li-${i}-${idx}`)}</li>
              ))}
            </ol>,
          )
        } else {
          result.push(
            <ul key={`ul-${i}`}>
              {listItems.map((item, idx) => (
                <li key={idx} className={item.isTask ? 'task-item' : ''}>
                  {item.isTask && (
                    <input
                      type="checkbox"
                      checked={item.checked}
                      readOnly
                      style={{ marginRight: 6, accentColor: 'var(--ink)' }}
                    />
                  )}
                  {renderInline(item.text, assetMap, onSeek, `li-${i}-${idx}`)}
                </li>
              ))}
            </ul>,
          )
        }
        continue
      }

      // 8. Paragraph
      const paraLines: string[] = []
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].trim().startsWith('#') &&
        !lines[i].trim().startsWith('```') &&
        !lines[i].trim().startsWith('>') &&
        !lines[i].trim().startsWith('- ') &&
        !lines[i].trim().startsWith('* ') &&
        !/^\d+\.\s/.test(lines[i].trim()) &&
        !(lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) &&
        lines[i].trim() !== '---' &&
        lines[i].trim() !== '***' &&
        !lines[i].trim().match(/^!\[(.*?)\]\((.*?)\)$/)
      ) {
        paraLines.push(lines[i].trim())
        i++
      }

      if (paraLines.length > 0) {
        result.push(
          <p key={`p-${i}`} className="doc-p">
            {renderInline(paraLines.join(' '), assetMap, onSeek, `p-${i}`)}
          </p>,
        )
      }
    }

    return result
  }, [markdown, assetMap, onSeek, onImageClick])

  return <article className="doc-preview-body">{blocks}</article>
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
  const [allNotes, setAllNotes] = useState<GeneratedNote[]>([])
  const [allCaptures, setAllCaptures] = useState<SearchableCapture[]>([])

  // Filters, Search & Tabs
  const [activeGroupId, setActiveGroupId] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [timelineSearch, setTimelineSearch] = useState('')
  const [highlightTimestamp, setHighlightTimestamp] = useState<number | null>(null)
  const [expandedMatches, setExpandedMatches] = useState<Record<string, boolean>>({})
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
  const [docViewMode, setDocViewMode] = useState<'preview' | 'code'>('preview')
  const [previewZoomSrc, setPreviewZoomSrc] = useState<string | null>(null)

  const docLineCount = useMemo(() => (docCustomText ? docCustomText.split('\n').length : 0), [docCustomText])
  const docByteSize = useMemo(() => {
    if (!docCustomText) return '0 B'
    const bytes = new Blob([docCustomText]).size
    if (bytes < 1024) return `${bytes} B`
    return `${(bytes / 1024).toFixed(1)} KB`
  }, [docCustomText])

  // Summary Viewer / Editor State
  const [summaryCustomText, setSummaryCustomText] = useState('')
  const [summaryEdited, setSummaryEdited] = useState(false)
  const [summaryViewMode, setSummaryViewMode] = useState<'preview' | 'code'>('preview')
  const prevSummarySessionIdRef = useRef<string | null>(null)

  const summaryLineCount = useMemo(() => (summaryCustomText ? summaryCustomText.split('\n').length : 0), [summaryCustomText])
  const summaryByteSize = useMemo(() => {
    if (!summaryCustomText) return '0 B'
    const bytes = new Blob([summaryCustomText]).size
    if (bytes < 1024) return `${bytes} B`
    return `${(bytes / 1024).toFixed(1)} KB`
  }, [summaryCustomText])

  // Ask AI Proposals State (Preview vs Code per proposal)
  const [proposalViewModes, setProposalViewModes] = useState<Record<string, 'preview' | 'code'>>({})
  const [proposalCustomText, setProposalCustomText] = useState<Record<string, string>>({})

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

  // Capture Quality & Session Health Metrics
  const lastSuccessfulFrame = useMemo(() => {
    return (
      captures
        .filter((c) => c.screenshotDataUrl && c.processingStatus !== 'failed')
        .sort((a, b) => b.capturedAt - a.capturedAt)[0] ?? null
    )
  }, [captures])

  const pendingCaptures = useMemo(() => {
    return captures.filter((c) => c.processingStatus === 'pending' || c.processingStatus === 'processing')
  }, [captures])

  const failedCaptures = useMemo(() => {
    return captures.filter((c) => c.processingStatus === 'failed')
  }, [captures])

  const lastCapture = useMemo(() => {
    return captures.length > 0 ? captures[captures.length - 1] : null
  }, [captures])

  const [previewThumbnailOpen, setPreviewThumbnailOpen] = useState(false)
  const [monitorExpanded, setMonitorExpanded] = useState(true)

  // Diagnostics & Silent Stoppage Warnings
  const timeSinceLastCaptureSec = lastCapture ? Math.floor((Date.now() - lastCapture.capturedAt) / 1000) : 0
  const isStalled = Boolean(
    selectedSession &&
      selectedSession.status === 'active' &&
      currentVideo?.isPlaying &&
      captures.length > 0 &&
      timeSinceLastCaptureSec > Math.max(45, (selectedSession.captureIntervalSeconds || 30) * 2.2),
  )

  const isUnsupportedVideo = Boolean(
    selectedSession &&
      selectedSession.status === 'active' &&
      (!currentVideo || (currentVideo.videoCount === 0 && currentVideo.durationSeconds === 0)),
  )

  const isCanvasRestricted = Boolean(currentVideo && currentVideo.canExtractFrame === false)
  const isAdPlaying = Boolean(currentVideo?.isAd)
  const isPausedWhilePlaying = Boolean(
    selectedSession && selectedSession.status === 'paused' && currentVideo?.isPlaying,
  )

  const handleRetryAllFailed = async () => {
    if (failedCaptures.length === 0) return
    showToast(`Retrying ${failedCaptures.length} failed ${failedCaptures.length === 1 ? 'capture' : 'captures'}…`)
    for (const cap of failedCaptures) {
      try {
        await sendExtensionMessage({ type: 'CAPTURE_RETRY', captureId: cap.id })
      } catch (err) {
        console.warn('Retry error:', err)
      }
    }
    if (selectedSessionIdRef.current) await refresh(selectedSessionIdRef.current)
  }

  // Keep docCustomText updated when session/notes change unless manually edited
  useEffect(() => {
    if (selectedSession && !docEdited) {
      setDocCustomText(compileMarkdown(selectedSession, notes, captures))
    }
  }, [selectedSession, notes, captures, docEdited])

  // Keep summaryCustomText updated when session/summary changes unless manually edited
  useEffect(() => {
    if (selectedSession) {
      if (prevSummarySessionIdRef.current !== selectedSession.id) {
        setSummaryCustomText(selectedSession.summary || '')
        setSummaryEdited(false)
        prevSummarySessionIdRef.current = selectedSession.id
      } else if (!summaryEdited) {
        setSummaryCustomText(selectedSession.summary || '')
      }
    } else {
      setSummaryCustomText('')
      setSummaryEdited(false)
      prevSummarySessionIdRef.current = null
    }
  }, [selectedSession, summaryEdited])

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

  // Reload sessions, groups & search index
  const refresh = useCallback(
    async (targetId?: string) => {
      void checkBackendStatus()
      const [nextState, allSessions, allGroups, loadedNotes, loadedCaptures] = await Promise.all([
        sendExtensionMessage({ type: 'UI_GET_STATE' }).catch(() => ({ success: true, session: null, video: null } as ExtensionResponse)),
        listSessions().catch(() => [] as LearningSession[]),
        listGroups().catch(() => [] as NoteGroup[]),
        listAllNotes().catch(() => [] as GeneratedNote[]),
        listSearchableCaptures().catch(() => [] as SearchableCapture[]),
      ])

      setState(nextState)
      setGroups(allGroups)
      setAllNotes(loadedNotes)
      setAllCaptures(loadedCaptures)

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
  const openNote = (id: string, initialTimestamp?: number) => {
    selectedSessionIdRef.current = id
    setSelectedSessionId(id)
    setView('note')
    setActiveTab('tl')
    setNoteCardMenuId(null)
    setDocEdited(false)
    void refresh(id)
    if (initialTimestamp !== undefined && initialTimestamp >= 0) {
      setHighlightTimestamp(initialTimestamp)
      void handleSeek(initialTimestamp, id)
    }
  }

  const goHome = () => {
    selectedSessionIdRef.current = 'home'
    setSelectedSessionId('home')
    setView('home')
    setNoteCardMenuId(null)
    setHighlightTimestamp(null)
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

  const handleSeek = (ts: number, targetSessionId?: string) => {
    const sId = targetSessionId || selectedSession?.id
    if (!sId) return
    try {
      void sendExtensionMessage({
        type: 'SEEK_VIDEO',
        sessionId: sId,
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

  // Summary & Proposal Markdown Helpers
  const formatProposalMarkdown = (p: AskAiProposal): string => {
    const points = (p.keyPoints || []).filter(Boolean).map((pt) => `- ${pt}`).join('\n')
    return `### ${p.title}\n\n${p.explanation}${points ? `\n\n${points}` : ''}`
  }

  const parseProposalMarkdown = (text: string, fallback: AskAiProposal): { title: string; explanation: string; keyPoints: string[] } => {
    const trimmed = text.trim()
    if (!trimmed) return { title: fallback.title, explanation: fallback.explanation, keyPoints: fallback.keyPoints }
    const lines = trimmed.split('\n')
    let title = fallback.title
    let startIndex = 0

    const firstLine = lines[0].trim()
    const headingMatch = firstLine.match(/^#+\s*(.*)$/)
    if (headingMatch && headingMatch[1].trim()) {
      title = headingMatch[1].trim()
      startIndex = 1
    }

    const expLines: string[] = []
    const points: string[] = []

    for (let i = startIndex; i < lines.length; i++) {
      const l = lines[i]
      const bulletMatch = l.trim().match(/^[-*]\s+(.*)$/)
      if (bulletMatch) {
        points.push(bulletMatch[1].trim())
      } else {
        expLines.push(l)
      }
    }

    const explanation = expLines.join('\n').trim() || fallback.explanation
    return {
      title,
      explanation,
      keyPoints: points.length > 0 ? points : fallback.keyPoints,
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
      setSummaryCustomText(res.formattedMarkdown)
      setSummaryEdited(false)
      await refresh(selectedSession.id)
      showToast('Review guide generated')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not generate summary')
    } finally {
      setIsSummarizing(false)
    }
  }

  const handleCopyRichSummary = async () => {
    if (!selectedSession) {
      showToast('No session selected')
      return
    }
    const text = summaryCustomText || selectedSession.summary || ''
    if (!text) {
      showToast('No summary to copy')
      return
    }
    try {
      const html = markdownToHtml(text, captures)
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ])
        showToast('Summary copied with images (paste in Notion/Docs)')
        return
      }
      await navigator.clipboard.writeText(text)
      showToast('Summary copied')
    } catch {
      try {
        await navigator.clipboard.writeText(text)
        showToast('Summary copied')
      } catch {
        showToast('Could not copy summary')
      }
    }
  }

  const handleCopyPlainSummary = async () => {
    const text = summaryCustomText || selectedSession?.summary || ''
    if (!text) {
      showToast('No summary to copy')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      showToast('Summary markdown copied')
    } catch {
      showToast('Could not copy summary')
    }
  }

  const handleSaveSummaryEdits = async () => {
    if (!selectedSession) return
    try {
      const updated: LearningSession = {
        ...selectedSession,
        summary: summaryCustomText,
        summaryGeneratedAt: Date.now(),
      }
      await saveSession(updated)
      setSummaryEdited(false)
      await refresh(selectedSession.id)
      showToast('Summary edits saved')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save summary')
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

    const customText = proposalCustomText[proposalId]
    const parsed = customText
      ? parseProposalMarkdown(customText, proposal)
      : { title: proposal.title, explanation: proposal.explanation, keyPoints: proposal.keyPoints }

    const now = Date.now()
    const newNote: GeneratedNote = {
      id: crypto.randomUUID(),
      sessionId: selectedSession.id,
      title: parsed.title,
      explanation: parsed.explanation,
      keyPoints: parsed.keyPoints,
      startTimestampSeconds: proposal.timestampSeconds,
      createdAt: now,
      updatedAt: now,
      userEdited: true,
    }

    await storageSaveNote(newNote)
    setAskProposals((prev) =>
      prev.map((p) => (p.id === proposalId ? { ...p, added: true, title: parsed.title, explanation: parsed.explanation, keyPoints: parsed.keyPoints } : p)),
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
        setSummaryCustomText(res.formattedMarkdown)
        setSummaryEdited(false)
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
    setProposalViewModes((prev) => {
      const next = { ...prev }
      delete next[proposalId]
      return next
    })
    setProposalCustomText((prev) => {
      const next = { ...prev }
      delete next[proposalId]
      return next
    })
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

  const handleCopyRichDoc = async () => {
    if (!selectedSession) {
      showToast('Open a note to copy document')
      return
    }
    try {
      const markdown = docCustomText || compileMarkdown(selectedSession, notes, captures)
      const html = docEdited
        ? markdownToHtml(docCustomText, captures)
        : compileRichHtml(selectedSession, notes, captures)

      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
        const textBlob = new Blob([markdown], { type: 'text/plain' })
        const htmlBlob = new Blob([html], { type: 'text/html' })
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': textBlob,
            'text/html': htmlBlob,
          }),
        ])
        showToast('Copied with images! Paste in Notion, Docs, or OneNote')
        return
      }

      await navigator.clipboard.writeText(markdown)
      showToast('Copied markdown (browser did not support rich paste)')
    } catch (err) {
      console.warn('Rich copy fallback to plain text:', err)
      try {
        const markdown = docCustomText || compileMarkdown(selectedSession, notes, captures)
        await navigator.clipboard.writeText(markdown)
        showToast('Copied markdown text (images omitted)')
      } catch {
        showToast('Could not copy document')
      }
    }
  }

  const handleCopyPlainMarkdown = async () => {
    if (!selectedSession) {
      showToast('Open a note to copy document')
      return
    }
    try {
      const markdown = docCustomText || compileMarkdown(selectedSession, notes, captures)
      await navigator.clipboard.writeText(markdown)
      showToast('Markdown copied to clipboard')
    } catch {
      showToast('Could not copy markdown')
    }
  }

  const handleCopySingleNote = async (note: GeneratedNote, talkText?: string, screenshotUrl?: string) => {
    const keyPointsText =
      note.keyPoints.length > 0 ? `\n\nKey points:\n${note.keyPoints.map((p) => `- ${p}`).join('\n')}` : ''
    const quoteText = talkText ? `\n\nOriginal talk: "${talkText}"` : ''
    const plainText = `${formatTimestamp(note.startTimestampSeconds)} - ${note.title}\n\n${note.explanation}${keyPointsText}${quoteText}`

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1e293b;">
        <h3 style="font-size: 18px; margin: 0 0 8px 0; color: #0f172a;">${formatTimestamp(note.startTimestampSeconds)} — ${escapeHtml(note.title)}</h3>
        <p style="margin: 0 0 10px 0; color: #334155;">${escapeHtml(note.explanation)}</p>
        ${note.keyPoints.length > 0 ? `
          <h4 style="font-size: 14px; margin: 10px 0 4px 0; color: #475569;">Key points</h4>
          <ul style="margin: 4px 0 10px 20px; padding: 0;">
            ${note.keyPoints.map((p) => `<li style="margin-bottom: 4px;">${formatInline(p)}</li>`).join('')}
          </ul>
        ` : ''}
        ${quoteText ? `<blockquote style="border-left: 3px solid #cbd5e1; margin: 8px 0; padding-left: 10px; color: #64748b;"><em>${escapeHtml(talkText!)}</em></blockquote>` : ''}
        ${screenshotUrl ? `
          <div style="margin: 12px 0;">
            <img src="${screenshotUrl}" alt="Video frame at ${formatTimestamp(note.startTimestampSeconds)}" style="max-width: 100%; border-radius: 6px; border: 1px solid #e2e8f0; display: block;" />
          </div>
        ` : ''}
      </div>
    `

    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ])
        showToast(screenshotUrl ? 'Note copied with image' : 'Note copied to clipboard')
        return
      }
    } catch {}

    await navigator.clipboard.writeText(plainText)
    showToast('Note copied to clipboard')
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

  // Full-Text Search across Notes, Explanations, Keypoints, Transcripts, Slides & Summaries
  const searchMatchesBySession = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return new Map<string, SessionSearchMatch[]>()

    const map = new Map<string, SessionSearchMatch[]>()

    // 1. Search in notes (title, explanation, keyPoints)
    for (const note of allNotes) {
      const matches: SessionSearchMatch[] = []
      if (note.title && note.title.toLowerCase().includes(q)) {
        matches.push({
          id: `${note.id}-title`,
          sessionId: note.sessionId,
          timestampSeconds: note.startTimestampSeconds,
          kind: 'note-title',
          snippet: note.title,
          noteId: note.id,
        })
      }
      if (note.explanation && note.explanation.toLowerCase().includes(q)) {
        matches.push({
          id: `${note.id}-exp`,
          sessionId: note.sessionId,
          timestampSeconds: note.startTimestampSeconds,
          kind: 'explanation',
          snippet: extractSnippet(note.explanation, q),
          noteId: note.id,
        })
      }
      if (Array.isArray(note.keyPoints)) {
        for (let i = 0; i < note.keyPoints.length; i++) {
          const pt = note.keyPoints[i]
          if (pt && pt.toLowerCase().includes(q)) {
            matches.push({
              id: `${note.id}-kp-${i}`,
              sessionId: note.sessionId,
              timestampSeconds: note.startTimestampSeconds,
              kind: 'keypoint',
              snippet: extractSnippet(pt, q),
              noteId: note.id,
            })
          }
        }
      }

      if (matches.length > 0) {
        const existing = map.get(note.sessionId) ?? []
        existing.push(...matches)
        map.set(note.sessionId, existing)
      }
    }

    // 2. Search in captures (spoken audio transcripts and slide OCR text)
    for (const cap of allCaptures) {
      if (cap.transcriptText && cap.transcriptText.toLowerCase().includes(q)) {
        const isSlide = cap.transcriptText.startsWith('[Visual slide')
        const existing = map.get(cap.sessionId) ?? []
        // Avoid duplicate match at exact same timestamp with same text
        const hasDuplicate = existing.some(
          (m) => Math.abs(m.timestampSeconds - cap.timestampSeconds) < 2 && m.snippet.toLowerCase() === cap.transcriptText.toLowerCase()
        )
        if (!hasDuplicate) {
          existing.push({
            id: `${cap.id}-cap`,
            sessionId: cap.sessionId,
            timestampSeconds: cap.timestampSeconds,
            kind: isSlide ? 'slide' : 'transcript',
            snippet: extractSnippet(cap.transcriptText, q),
          })
          map.set(cap.sessionId, existing)
        }
      }
    }

    // 3. Search in session summaries
    for (const s of sessions) {
      if (s.summary && s.summary.toLowerCase().includes(q)) {
        const existing = map.get(s.id) ?? []
        existing.push({
          id: `${s.id}-sum`,
          sessionId: s.id,
          timestampSeconds: 0,
          kind: 'summary',
          snippet: extractSnippet(s.summary, q),
        })
        map.set(s.id, existing)
      }
    }

    // Sort matches in each session by timestamp
    for (const [sId, list] of map.entries()) {
      list.sort((a, b) => a.timestampSeconds - b.timestampSeconds)
      map.set(sId, list)
    }

    return map
  }, [allNotes, allCaptures, sessions, searchQuery])

  // Filtered notes list on home
  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return sessions
      .filter((s) => {
        const matchesGroup =
          activeGroupId === 'all'
            ? true
            : activeGroupId === 'none'
            ? (!s.groupId || !groups.some((g) => g.id === s.groupId))
            : s.groupId === activeGroupId

        if (!matchesGroup) return false
        if (!q) return true

        const matchesTitle = s.videoTitle.toLowerCase().includes(q) || (s.platformName || '').toLowerCase().includes(q)
        const matchesNotes = (searchMatchesBySession.get(s.id)?.length ?? 0) > 0

        return matchesTitle || matchesNotes
      })
      .sort((a, b) => {
        if (!q) return b.startedAt - a.startedAt
        const aMatches = searchMatchesBySession.get(a.id)?.length ?? 0
        const bMatches = searchMatchesBySession.get(b.id)?.length ?? 0
        const aTitle = a.videoTitle.toLowerCase().includes(q) ? 10 : 0
        const bTitle = b.videoTitle.toLowerCase().includes(q) ? 10 : 0
        return bMatches + bTitle - (aMatches + aTitle)
      })
  }, [sessions, activeGroupId, searchQuery, groups, searchMatchesBySession])

  const totalMatchCount = useMemo(() => {
    if (!searchQuery.trim()) return 0
    let count = 0
    for (const s of filteredSessions) {
      count += searchMatchesBySession.get(s.id)?.length ?? 0
    }
    return count
  }, [searchQuery, filteredSessions, searchMatchesBySession])

  // Filtered notes inside active session timeline
  const filteredTimelineNotes = useMemo(() => {
    const q = timelineSearch.trim().toLowerCase()
    if (!q) return notes
    return notes.filter((note) => {
      if (note.title && note.title.toLowerCase().includes(q)) return true
      if (note.explanation && note.explanation.toLowerCase().includes(q)) return true
      if (note.keyPoints?.some((pt) => pt && pt.toLowerCase().includes(q))) return true
      const matchingCapture = captures.find((c) => c.id === note.captureId || Math.abs(c.timestampSeconds - note.startTimestampSeconds) <= 10)
      if (matchingCapture?.transcriptText && matchingCapture.transcriptText.toLowerCase().includes(q)) return true
      return false
    })
  }, [notes, captures, timelineSearch])

  // Scroll to highlighted note on click-through
  useEffect(() => {
    if (highlightTimestamp === null || view !== 'note' || notes.length === 0) return
    const matchingNote =
      notes.find((n) => Math.abs(n.startTimestampSeconds - highlightTimestamp) < 15) ??
      notes.reduce((closest, curr) =>
        Math.abs(curr.startTimestampSeconds - highlightTimestamp) < Math.abs(closest.startTimestampSeconds - highlightTimestamp)
          ? curr
          : closest
      )
    if (matchingNote) {
      const el = document.getElementById(`note-${matchingNote.id}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
    const timer = setTimeout(() => setHighlightTimestamp(null), 3000)
    return () => clearTimeout(timer)
  }, [highlightTimestamp, view, notes])

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
                <button onClick={handleCopyRichDoc}>Copy with images</button>
                <button onClick={handleCopyPlainMarkdown}>Copy markdown</button>
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
              placeholder="Search notes, explanations, transcripts, slides…"
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

            {/* Search Summary Bar */}
            {searchQuery.trim() && (
              <div className="search-summary-bar">
                <span>
                  Found <b>{totalMatchCount}</b> {totalMatchCount === 1 ? 'matching moment' : 'matching moments'} across <b>{filteredSessions.length}</b> {filteredSessions.length === 1 ? 'lecture' : 'lectures'}
                </span>
                <button className="lk" onClick={() => setSearchQuery('')}>Clear search</button>
              </div>
            )}

            {/* Notes List */}
            <div id="list">
              {filteredSessions.map((session) => {
                const groupName = session.groupId ? groups.find((g) => g.id === session.groupId)?.name : null
                const sessionDate = new Date(session.startedAt).toLocaleDateString('en-US')
                const isCardMenuOpen = noteCardMenuId === session.id
                const matchesForSession = searchMatchesBySession.get(session.id) ?? []
                return (
                  <article
                    key={session.id}
                    className={`nc ${isCardMenuOpen ? 'menu-open' : ''}`}
                    style={isCardMenuOpen ? { zIndex: 60 } : undefined}
                  >
                    <button className="nc-main" onClick={() => openNote(session.id)}>
                      <h3>
                        <HighlightSnippet text={session.videoTitle} query={searchQuery} />
                      </h3>
                      <div className="sub">
                        <span>
                          <HighlightSnippet text={session.platformName || 'Web video'} query={searchQuery} />
                        </span>
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

                    {/* Matching Moments Snippets */}
                    {searchQuery.trim() && matchesForSession.length > 0 && (
                      <div className="nc-matches">
                        <div className="nc-matches-head">
                          <span>Matching moments in notes & video</span>
                          <span>{matchesForSession.length}</span>
                        </div>
                        <div className="nc-matches-list">
                          {(expandedMatches[session.id] ? matchesForSession : matchesForSession.slice(0, 3)).map((m) => (
                            <div
                              key={m.id}
                              className="nc-match-item"
                              onClick={() => openNote(session.id, m.timestampSeconds)}
                              title={`Jump to ${formatTimestamp(m.timestampSeconds)} in ${session.videoTitle}`}
                            >
                              <button
                                className="ts"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openNote(session.id, m.timestampSeconds)
                                }}
                                title="Jump to this moment"
                              >
                                ▶ {formatTimestamp(m.timestampSeconds)}
                              </button>
                              <span className="nc-match-badge">{formatMatchKind(m.kind)}</span>
                              <span className="nc-match-snippet">
                                <HighlightSnippet text={m.snippet} query={searchQuery} />
                              </span>
                            </div>
                          ))}
                          {matchesForSession.length > 3 && (
                            <button
                              className="nc-match-more-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                setExpandedMatches((prev) => ({ ...prev, [session.id]: !prev[session.id] }))
                              }}
                            >
                              {expandedMatches[session.id]
                                ? 'Show fewer matches'
                                : `+${matchesForSession.length - 3} more matching moments…`}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

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
                    <>
                      <p>No notes, explanations, or transcripts match "<b>{searchQuery}</b>".</p>
                      <button
                        className="btn"
                        style={{ marginTop: 12, minHeight: 34, fontSize: 12 }}
                        onClick={() => setSearchQuery('')}
                      >
                        Clear search
                      </button>
                    </>
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
                      className="btn"
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

              {/* Capture Quality & Session Health Monitor */}
              <div className="health-monitor">
                <div className="health-monitor-header">
                  <div className="health-status-badge">
                    <span
                      className={`health-dot ${
                        isUnsupportedVideo || failedCaptures.length > 0
                          ? 'dot-error'
                          : isStalled || isCanvasRestricted
                          ? 'dot-warning'
                          : selectedSession.status === 'paused'
                          ? 'dot-paused'
                          : selectedSession.status === 'completed'
                          ? 'dot-completed'
                          : 'dot-healthy'
                      }`}
                    />
                    <span className="health-status-title">
                      {isUnsupportedVideo
                        ? 'No video detected'
                        : isStalled
                        ? 'Capture stalled'
                        : isCanvasRestricted
                        ? 'Canvas restricted'
                        : failedCaptures.length > 0
                        ? `${failedCaptures.length} capture failed`
                        : selectedSession.status === 'paused'
                        ? 'Session paused'
                        : selectedSession.status === 'completed'
                        ? 'Session completed'
                        : 'Capture active & healthy'}
                    </span>
                  </div>
                  <button
                    className="health-toggle-btn"
                    onClick={() => setMonitorExpanded((prev) => !prev)}
                    title={monitorExpanded ? 'Collapse health details' : 'Expand health details'}
                  >
                    {monitorExpanded ? 'Hide details' : 'Show health monitor'}
                  </button>
                </div>

                {monitorExpanded && (
                  <div className="health-grid">
                    {/* Item 1: Last Frame */}
                    <div className="health-item featured" title="Most recent frame captured from player">
                      <div className="health-item-header">
                        <span className="health-item-label">Last frame</span>
                        {lastSuccessfulFrame?.screenshotDataUrl && (
                          <span className="health-hint">Click to enlarge</span>
                        )}
                      </div>
                      <div className="health-item-value">
                        {lastSuccessfulFrame?.screenshotDataUrl ? (
                          <div
                            className="last-frame-wrap"
                            onClick={() => setPreviewThumbnailOpen((p) => !p)}
                            title="Click to preview captured frame"
                          >
                            <img
                              src={lastSuccessfulFrame.screenshotDataUrl}
                              alt="Last frame"
                              className="last-frame-thumb"
                            />
                            <div className="last-frame-meta">
                              <span className="last-frame-time">{formatTimestamp(lastSuccessfulFrame.timestampSeconds)}</span>
                              <span className="health-sub">{formatTimeAgo(lastSuccessfulFrame.capturedAt)} ago</span>
                            </div>
                          </div>
                        ) : (
                          <span className="health-muted">None yet</span>
                        )}
                      </div>
                    </div>

                    {/* Item 2: Captions */}
                    <div className="health-item" title="Subtitle or caption stream status">
                      <div className="health-item-label">Captions</div>
                      <div className="health-item-value">
                        {currentVideo?.hasCaptions || captures.some((c) => c.transcriptText && !c.transcriptText.startsWith('[Visual slide')) ? (
                          <span className="health-pill" title={currentVideo?.captionSource || 'Captions available'}>
                            {currentVideo?.captionSource || 'Detected'}
                          </span>
                        ) : (
                          <span className="health-pill muted" title="AI notes will be grounded visually on the slide frames">
                            Visual only
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Item 3: Audio Status */}
                    <div className="health-item" title="OpenAI Whisper tab audio capture">
                      <div className="health-item-label">Tab audio</div>
                      <div className="health-item-value">
                        {selectedSession.captureAudio ? (
                          <span className="health-pill">
                            Whisper on
                          </span>
                        ) : (
                          <span className="health-pill muted">
                            Off
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Item 4: Pending AI */}
                    <div className="health-item" title="AI note generation requests in flight">
                      <div className="health-item-label">AI queue</div>
                      <div className="health-item-value">
                        {pendingCaptures.length > 0 ? (
                          <span className="health-pill pending">
                            <span className="pulsing-dot" /> {pendingCaptures.length} in flight
                          </span>
                        ) : (
                          <span className="health-pill muted">
                            Idle (0)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Item 5: Failed Captures */}
                    <div className="health-item" title="Failed note generations">
                      <div className="health-item-label">Failures</div>
                      <div className="health-item-value">
                        {failedCaptures.length > 0 ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="health-pill error">
                              {failedCaptures.length} failed
                            </span>
                            <button
                              className="health-mini-btn"
                              onClick={() => void handleRetryAllFailed()}
                              title="Retry all failed AI requests"
                            >
                              Retry all
                            </button>
                          </div>
                        ) : (
                          <span className="health-pill muted">
                            0 errors
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Popover Thumbnail Preview */}
                {previewThumbnailOpen && lastSuccessfulFrame?.screenshotDataUrl && (
                  <div className="frame-preview-popover" onClick={() => setPreviewThumbnailOpen(false)}>
                    <div className="frame-preview-box" onClick={(e) => e.stopPropagation()}>
                      <div className="frame-preview-head">
                        <span>Frame at {formatTimestamp(lastSuccessfulFrame.timestampSeconds)}</span>
                        <button className="health-mini-btn" onClick={() => setPreviewThumbnailOpen(false)}>✕</button>
                      </div>
                      <img src={lastSuccessfulFrame.screenshotDataUrl} alt="Frame preview" />
                    </div>
                  </div>
                )}

                {/* Proactive Warnings & Alerts */}
                {isStalled && (
                  <div className="health-alert" role="alert">
                    <span><b>Capture stalled:</b> Video is playing at {formatTimestamp(currentTimestamp)}, but no new frame was captured in {timeSinceLastCaptureSec}s.</span>
                    <button className="health-alert-btn" onClick={() => void handleCaptureNow()}>Capture now</button>
                  </div>
                )}

                {isUnsupportedVideo && (
                  <div className="health-alert" role="alert">
                    <span><b>No video player detected:</b> Make sure the lecture video tab is active and playing.</span>
                    <button className="health-alert-btn" onClick={() => void connectCurrentPage()}>Connect page</button>
                  </div>
                )}

                {isCanvasRestricted && (
                  <div className="health-alert" role="alert">
                    <span><b>Canvas restricted by video host:</b> Direct frame drawing is blocked by CORS. Keep the video tab in the foreground so screenshot capture can work.</span>
                  </div>
                )}

                {isAdPlaying && (
                  <div className="health-alert" role="alert">
                    <span><b>Advertisement detected:</b> Capturing is automatically paused so ads don't pollute your notes.</span>
                  </div>
                )}

                {isPausedWhilePlaying && (
                  <div className="health-alert" role="alert">
                    <span><b>Session is paused:</b> The video is playing, but note capturing is paused.</span>
                    <button className="health-alert-btn" onClick={() => void handleTogglePause()}>Resume</button>
                  </div>
                )}
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
                {/* Search within lecture */}
                {notes.length > 0 && (
                  <div className="timeline-search-bar">
                    <input
                      className="search timeline-search"
                      type="search"
                      placeholder="Search explanations, slides, key points in this lecture…"
                      aria-label="Search within this lecture"
                      value={timelineSearch}
                      onChange={(e) => setTimelineSearch(e.target.value)}
                    />
                    {timelineSearch && (
                      <span className="timeline-search-count">
                        {filteredTimelineNotes.length} of {notes.length} notes
                      </span>
                    )}
                  </div>
                )}

                {timelineSearch && filteredTimelineNotes.length === 0 ? (
                  <div className="empty" style={{ padding: '24px 0' }}>
                    <p>No moments in this lecture match "<b>{timelineSearch}</b>".</p>
                    <button
                      className="btn"
                      style={{ marginTop: 10, minHeight: 32, fontSize: 12 }}
                      onClick={() => setTimelineSearch('')}
                    >
                      Clear search
                    </button>
                  </div>
                ) : notes.length > 0 || captures.some((c) => c.processingStatus === 'pending' || c.processingStatus === 'processing' || c.processingStatus === 'failed') ? (
                  <div className="rail">
                    {/* Render pending/processing/failed captures first if waiting */}
                    {!timelineSearch && captures
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
                    {filteredTimelineNotes.map((note) => {
                      const matchingCapture =
                        captures.find((c) => c.id === note.captureId) ??
                        captures.find((c) => Math.abs(c.timestampSeconds - note.startTimestampSeconds) <= 10)
                      const screenshot = matchingCapture?.screenshotDataUrl
                      const talkText = matchingCapture?.transcriptText?.trim()
                      const isHighlighted = highlightTimestamp !== null && Math.abs(note.startTimestampSeconds - highlightTimestamp) < 15
                      return (
                        <article
                          key={note.id}
                          id={`note-${note.id}`}
                          className={`note ${isHighlighted ? 'note-highlight' : ''}`}
                        >
                          <div className="nh">
                            <button className="ts" onClick={() => handleSeek(note.startTimestampSeconds)} title="Jump to this moment">
                              ▶ {formatTimestamp(note.startTimestampSeconds)}
                            </button>
                            <span className="sp" />
                            <div className="note-top-actions">
                              <button
                                className="ib"
                                style={{ width: 28, height: 28 }}
                                onClick={() => void handleCopySingleNote(note, talkText, screenshot)}
                                aria-label="Copy note"
                                title={screenshot ? 'Copy note with image (Notion / Docs)' : 'Copy note text'}
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
                          <h3>
                            <HighlightSnippet text={note.title} query={timelineSearch} />
                          </h3>
                          <p>
                            <HighlightSnippet text={note.explanation} query={timelineSearch} />
                          </p>
                          {note.keyPoints.length > 0 && (
                            <ul>
                              {note.keyPoints.map((pt, i) => (
                                <li key={i}>
                                  <HighlightSnippet text={pt} query={timelineSearch} />
                                </li>
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

            {/* Tab 2: Document (GitHub-style Markdown viewer & editor) */}
            {activeTab === 'doc' && (
              <div id="view">
                <div className="doc-actions-bar">
                  <button
                    className="btn"
                    onClick={handleCopyRichDoc}
                    title="Copy rich notes with embedded screenshots to paste directly into Notion, Google Docs, or OneNote"
                  >
                    Copy with images
                  </button>
                  <button className="btn" onClick={handleCopyPlainMarkdown} title="Copy clean Markdown text">
                    Copy markdown
                  </button>
                  <button className="btn" onClick={handleExportZip} title="Download Markdown and screenshot assets bundle in a ZIP">
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

                <div className="doc-viewer-card">
                  <div className="doc-viewer-header">
                    <div className="doc-nav-tabs" role="tablist" aria-label="Markdown view mode">
                      <button
                        className={`doc-nav-tab ${docViewMode === 'preview' ? 'active' : ''}`}
                        onClick={() => setDocViewMode('preview')}
                        type="button"
                        role="tab"
                        aria-selected={docViewMode === 'preview'}
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        Preview
                      </button>
                      <button
                        className={`doc-nav-tab ${docViewMode === 'code' ? 'active' : ''}`}
                        onClick={() => setDocViewMode('code')}
                        type="button"
                        role="tab"
                        aria-selected={docViewMode === 'code'}
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="16 18 22 12 16 6" />
                          <polyline points="8 6 2 12 8 18" />
                        </svg>
                        Code
                      </button>
                    </div>

                    <span className="doc-meta-info">
                      {docLineCount} {docLineCount === 1 ? 'line' : 'lines'} · {docByteSize}
                    </span>
                  </div>

                  {docViewMode === 'preview' ? (
                    <MarkdownPreview
                      markdown={docCustomText}
                      captures={captures}
                      onSeek={handleSeek}
                      onImageClick={(src) => setPreviewZoomSrc(src)}
                    />
                  ) : (
                    <textarea
                      className="doc-editor"
                      value={docCustomText}
                      onChange={(e) => {
                        setDocCustomText(e.target.value)
                        setDocEdited(true)
                      }}
                      placeholder="Notes document in markdown..."
                      rows={20}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Tab 3: Summary (GitHub-style Markdown viewer & editor) */}
            {activeTab === 'sum' && (
              <div id="view">
                {selectedSession.summary ? (
                  <>
                    <div className="doc-actions-bar">
                      <button
                        className="btn"
                        onClick={handleCopyRichSummary}
                        title="Copy rich summary with embedded screenshots to paste directly into Notion, Google Docs, or OneNote"
                      >
                        Copy with images
                      </button>
                      <button
                        className="btn"
                        onClick={handleCopyPlainSummary}
                        title="Copy clean summary Markdown"
                      >
                        Copy markdown
                      </button>
                      <button
                        className="btn"
                        disabled={isSummarizing}
                        onClick={handleGenerateSummary}
                        title="Regenerate review guide from current notes"
                      >
                        {isSummarizing ? 'Updating…' : 'Regenerate summary'}
                      </button>
                      {summaryEdited && (
                        <>
                          <button
                            className="btn pri"
                            onClick={handleSaveSummaryEdits}
                            title="Save edited summary changes"
                          >
                            Save edits
                          </button>
                          <button
                            className="btn"
                            onClick={() => {
                              if (selectedSession) {
                                setSummaryCustomText(selectedSession.summary || '')
                                setSummaryEdited(false)
                                showToast('Reset summary to generated version')
                              }
                            }}
                            title="Discard manual edits and revert to AI generated summary"
                          >
                            Reset edits
                          </button>
                        </>
                      )}
                    </div>

                    <div className="doc-viewer-card">
                      <div className="doc-viewer-header">
                        <div className="doc-nav-tabs" role="tablist" aria-label="Summary view mode">
                          <button
                            className={`doc-nav-tab ${summaryViewMode === 'preview' ? 'active' : ''}`}
                            onClick={() => setSummaryViewMode('preview')}
                            type="button"
                            role="tab"
                            aria-selected={summaryViewMode === 'preview'}
                          >
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                            Preview
                          </button>
                          <button
                            className={`doc-nav-tab ${summaryViewMode === 'code' ? 'active' : ''}`}
                            onClick={() => setSummaryViewMode('code')}
                            type="button"
                            role="tab"
                            aria-selected={summaryViewMode === 'code'}
                          >
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="16 18 22 12 16 6" />
                              <polyline points="8 6 2 12 8 18" />
                            </svg>
                            Code
                          </button>
                        </div>

                        <span className="doc-meta-info">
                          {summaryLineCount} {summaryLineCount === 1 ? 'line' : 'lines'} · {summaryByteSize}
                        </span>
                      </div>

                      {summaryViewMode === 'preview' ? (
                        <MarkdownPreview
                          markdown={summaryCustomText}
                          captures={captures}
                          onSeek={handleSeek}
                          onImageClick={(src) => setPreviewZoomSrc(src)}
                        />
                      ) : (
                        <textarea
                          className="doc-editor"
                          value={summaryCustomText}
                          onChange={(e) => {
                            setSummaryCustomText(e.target.value)
                            setSummaryEdited(true)
                          }}
                          placeholder="Review guide in markdown..."
                          rows={20}
                        />
                      )}
                    </div>
                  </>
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
                  {isAskingAi && (
                    <div className="ask-proposal-card" style={{ opacity: 0.85 }}>
                      <div className="ask-proposal-top">
                        <span className="ask-badge pending">
                          <span className="badge-dot" />
                          Generating AI note…
                        </span>
                      </div>
                      <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--mute)' }}>
                        Synthesizing concepts, technical deep dives, and structured Markdown notes…
                      </p>
                    </div>
                  )}

                  {askProposals
                    .filter((p) => p.sessionId === selectedSession.id)
                    .map((proposal) => {
                      const proposalMode = proposalViewModes[proposal.id] ?? 'preview'
                      const currentText = proposalCustomText[proposal.id] ?? formatProposalMarkdown(proposal)
                      const pLines = currentText ? currentText.split('\n').length : 0
                      const pBytes = new Blob([currentText]).size
                      const pByteStr = pBytes < 1024 ? `${pBytes} B` : `${(pBytes / 1024).toFixed(1)} KB`

                      return (
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

                          <div className="doc-viewer-card ask-proposal-viewer">
                            <div className="doc-viewer-header">
                              <div className="doc-nav-tabs" role="tablist" aria-label="Proposal view mode">
                                <button
                                  className={`doc-nav-tab ${proposalMode === 'preview' ? 'active' : ''}`}
                                  onClick={() => setProposalViewModes((prev) => ({ ...prev, [proposal.id]: 'preview' }))}
                                  type="button"
                                  role="tab"
                                  aria-selected={proposalMode === 'preview'}
                                >
                                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                  Preview
                                </button>
                                <button
                                  className={`doc-nav-tab ${proposalMode === 'code' ? 'active' : ''}`}
                                  onClick={() => setProposalViewModes((prev) => ({ ...prev, [proposal.id]: 'code' }))}
                                  type="button"
                                  role="tab"
                                  aria-selected={proposalMode === 'code'}
                                >
                                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="16 18 22 12 16 6" />
                                    <polyline points="8 6 2 12 8 18" />
                                  </svg>
                                  Code
                                </button>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span className="doc-meta-info">
                                  {pLines} {pLines === 1 ? 'line' : 'lines'} · {pByteStr}
                                </span>
                                <button
                                  className="btn"
                                  style={{ minHeight: 24, padding: '0 8px', fontSize: 11 }}
                                  type="button"
                                  onClick={() => {
                                    void navigator.clipboard.writeText(currentText)
                                    showToast('Proposal markdown copied')
                                  }}
                                  title="Copy proposal markdown"
                                >
                                  Copy markdown
                                </button>
                              </div>
                            </div>

                            {proposalMode === 'preview' ? (
                              <MarkdownPreview
                                markdown={currentText}
                                captures={captures}
                                onSeek={handleSeek}
                                onImageClick={(src) => setPreviewZoomSrc(src)}
                              />
                            ) : (
                              <textarea
                                className="doc-editor"
                                style={{ minHeight: 140, fontSize: 13 }}
                                value={currentText}
                                onChange={(e) => {
                                  const val = e.target.value
                                  setProposalCustomText((prev) => ({ ...prev, [proposal.id]: val }))
                                }}
                                rows={8}
                                placeholder="Proposal markdown..."
                              />
                            )}
                          </div>

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
                      )
                    })}

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

        {/* Full Image Zoom Popover (shared across Timeline, Doc, Summary & Ask AI) */}
        {previewZoomSrc && (
          <div className="frame-preview-popover" onClick={() => setPreviewZoomSrc(null)}>
            <div className="frame-preview-box" onClick={(e) => e.stopPropagation()}>
              <div className="frame-preview-head">
                <span>Slide Preview</span>
                <button className="health-mini-btn" onClick={() => setPreviewZoomSrc(null)}>✕</button>
              </div>
              <img src={previewZoomSrc} alt="Slide preview" />
            </div>
          </div>
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
