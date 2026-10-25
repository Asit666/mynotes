# AI Video Notes — Final Project Specification and Development Plan

> **Project type:** AI-powered browser extension and learning assistant  
> **Primary platform:** Google Chrome and compatible Chromium-based browsers  
> **Initial video platform:** YouTube  
> **Frontend:** TypeScript, React, and Vite  
> **Extension architecture:** Chrome Extension Manifest V3  
> **Local database:** IndexedDB  
> **AI architecture:** Pluggable, multi-provider AI system  
> **Initial export destination:** Markdown compatible with Obsidian  
> **Additional integrations:** Notion, automatic Obsidian synchronization, and other note-taking applications

---

## Table of Contents

1. [Project Vision](#1-project-vision)
2. [Goals and Non-Goals](#2-goals-and-non-goals)
3. [Target Users and Use Cases](#3-target-users-and-use-cases)
4. [Core User Workflow](#4-core-user-workflow)
5. [Functional Requirements](#5-functional-requirements)
   - [Video Detection and Sessions](#51-module-a-video-detection-and-session-management)
   - [Automatic Capture Engine](#52-module-b-automatic-capture-engine)
   - [Screenshot Capture](#53-module-c-screenshot-capture-and-management)
   - [Transcript and Audio Processing](#54-module-d-transcript-and-audio-processing)
   - [AI Providers](#55-module-e-pluggable-ai-providers)
   - [AI Note Generation](#56-module-f-intelligent-note-generation)
   - [Topic Merging](#57-module-g-topic-merging-and-context-management)
   - [Dashboard and UI](#58-modules-h-and-i-user-interface)
   - [Note-Taking Styles](#59-module-j-configurable-learning-styles)
   - [Local Storage](#510-module-k-local-first-storage)
   - [Note Destinations](#511-modules-l-and-m-note-taking-integrations)
   - [Synchronization](#512-module-n-reliable-synchronization)
   - [AI Cost Management](#513-module-o-ai-usage-and-cost-management)
   - [Advanced Learning Features](#514-modules-p-through-s-learning-enhancements)
6. [System Architecture](#6-system-architecture)
7. [Recommended Technology Stack](#7-recommended-technology-stack)
8. [Project Directory Structure](#8-project-directory-structure)
9. [Data Model](#9-data-model)
10. [AI Context and Processing Pipeline](#10-ai-context-and-processing-pipeline)
11. [Security and Privacy Requirements](#11-security-and-privacy-requirements)
12. [Reliability and Error Recovery](#12-reliability-and-error-recovery)
13. [Accessibility and Usability](#13-accessibility-and-usability)
14. [Testing Strategy](#14-testing-strategy)
15. [Development Roadmap](#15-development-roadmap)
16. [MVP Scope](#16-mvp-scope)
17. [Acceptance Criteria](#17-acceptance-criteria)
18. [Risks and Mitigations](#18-risks-and-mitigations)
19. [Future Product Direction](#19-future-product-direction)
20. [Final Implementation Decisions](#20-final-implementation-decisions)
21. [Implementation Checklist](#21-implementation-checklist)

---

## 1. Project Vision

AI Video Notes is a browser extension that transforms educational videos into organized, timestamped, screenshot-supported learning notes. While a user watches a supported video, the extension collects available transcript segments and screenshots, analyzes useful context through a user-selected AI model, and generates structured notes that can be edited, searched, exported, and synchronized with external note-taking applications.

The system should help users:

1. Understand what is being explained in a video.
2. Identify the most important concepts and details.
3. Preserve visual information shown on screen.
4. Revisit the exact video moment associated with a note.
5. Save and organize information in a long-term knowledge base.
6. Create revision material from completed learning sessions.

### Guiding principles

- **User-controlled capture:** A session begins only when the user explicitly starts it.
- **Timestamp accuracy:** Notes and screenshots retain their video positions.
- **Multimodal context:** Use transcript text and screenshots together when available.
- **Provider independence:** AI providers should be replaceable behind a common interface.
- **Editable output:** Users own the final notes; AI must not silently overwrite their edits.
- **Local-first foundation:** The MVP should store notes and captures locally and work without a custom backend.
- **Portable data:** Notes should be exportable in open formats such as Markdown and JSON.
- **Reliable synchronization:** External destinations must support retries and duplicate prevention.
- **Privacy by design:** Capture, processing, retention, and external data sharing must be transparent.
- **Efficient processing:** Avoid unnecessary screenshot analysis and duplicate AI requests.

## 2. Goals and Non-Goals

### Goals

- Monitor supported video playback while a session is active.
- Capture context at a configurable interval, defaulting to 30 seconds of active playback.
- Collect available captions or transcript segments with timestamps.
- Capture screenshots when browser permissions and site restrictions permit it.
- Generate structured notes with AI.
- Merge related observations into coherent topics while preserving source references.
- Provide a side-panel learning dashboard.
- Store sessions, captures, screenshots, and notes locally.
- Export notes to Markdown with working source links and screenshot references.
- Support multiple AI providers through adapters.
- Add external destinations such as Notion and an Obsidian companion integration over time.

### Non-goals for the first release

- Building a full cloud-hosted learning platform.
- Supporting every video website from day one.
- Guaranteed frame extraction from protected or cross-origin video players.
- Automatically transcribing all audio without a supported audio source or permission.
- Bidirectional synchronization with every destination in the MVP.
- Replacing dedicated learning management systems.
- Circumventing DRM, access controls, or website security restrictions.

## 3. Target Users and Use Cases

### Students
Create structured notes from recorded lectures, course lessons, and educational videos.

### Programmers
Capture code examples, terminal commands, software architecture diagrams, debugging explanations, and technical definitions.

### Researchers
Collect observations, claims, visual evidence, timestamps, and questions for further investigation.

### Professionals
Create notes from technical demonstrations, training videos, webinars, and presentations.

### Self-learners
Build a searchable knowledge base across many videos and subjects.

The product should remain subject-agnostic. Note structure should adapt to the material rather than assuming every video is a programming tutorial.

## 4. Core User Workflow

1. The user opens a supported video, initially on YouTube.
2. The user opens the extension and starts a learning session.
3. The extension detects video metadata and reads the current playback position.
4. While the video plays, the capture engine schedules a capture every 30 seconds of active playback by default.
5. The extension collects available transcript text and attempts screenshot capture when permitted.
6. The capture record and its source information are saved locally before AI processing.
7. The AI pipeline processes transcript and selected visual context.
8. The note processor creates a new note or updates a related topic.
9. The side panel shows notes, captures, timestamps, screenshots, and processing status.
10. The user edits, adds personal observations, or asks follow-up questions.
11. The user exports the session as Markdown or synchronizes it to a configured destination.
12. When the session ends, the extension can generate a final summary and optional revision material.

### Example output

**Topic:** Java JIT Compiler  
**Timestamp:** 05:30–06:15

**Explanation:** The JVM can use a Just-In-Time compiler to compile frequently executed code into native machine code.

**Key points:**
- JIT stands for Just-In-Time compilation.
- It can optimize frequently executed code.
- Its purpose is to improve execution performance.

**Screenshot:** A diagram associated with this section of the video.  
**Source:** A link to the original video at 05:30.

---

## 5. Functional Requirements

### 5.1 Module A: Video Detection and Session Management

The extension should detect supported video players and allow the user to manage learning sessions.

#### Required capabilities

- Detect supported video pages and players.
- Retrieve video title, URL, platform, current playback position, and duration when available.
- Determine whether the video is playing, paused, or ended.
- Start, pause, resume, and stop a session.
- Add a manual capture or quick note at any time.
- Associate captures and notes with the correct session.
- Restore session state after supported interruptions.
- Avoid accidental duplicate sessions.
- Handle navigation to a new video or a different URL.

#### Popup controls

- **Start Session** — begin monitoring and capture.
- **Pause** — stop scheduled captures temporarily.
- **Resume** — continue the current session.
- **Capture Now** — request an immediate capture.
- **Add Quick Note** — save a user-written observation with a timestamp.
- **Stop Session** — finish capture and optionally start final processing.
- **Open Notes Dashboard** — open the side panel.
- **Export Notes** — export the session.

#### Session states

- `idle`
- `active`
- `paused`
- `processing`
- `completed`
- `interrupted`
- `failed`

One failed screenshot or AI request should not cause the entire session to be marked as failed.

When the user navigates to a different video, the extension should ask whether to finish the current session or start a new one when the situation requires it. It must not silently mix different videos into one session.

### 5.2 Module B: Automatic Capture Engine

The default capture interval is **30 seconds of active video playback**, not 30 seconds of wall-clock time.

#### Configurable intervals

- 15 seconds
- 30 seconds
- 60 seconds
- 120 seconds
- Custom interval

#### Capture process

1. Monitor video playback state and current position.
2. Determine when the next capture is due.
3. Read the actual video playback timestamp.
4. Collect available transcript content for the relevant time range.
5. Attempt to capture the current video frame or visible tab if permitted.
6. Associate the collected information with a stable capture ID and timestamp.
7. Persist the capture locally.
8. Queue eligible content for AI processing.
9. Update the dashboard when processing results become available.

#### Playback behavior

- **Paused:** Do not schedule automatic captures. Manual capture remains available.
- **Playing:** Schedule capture based on media playback progression.
- **Seeking:** Recalculate the next capture position and avoid treating a jump as uninterrupted playback.
- **Playback speed change:** Use the current media timestamp, not a fixed wall-clock assumption.
- **Video ended:** Stop scheduled captures and optionally finalize the session.
- **Browser interruption:** Restore pending work from persistent state where possible.
- **Tab visibility change:** Follow user settings and supported browser restrictions; do not claim background capture is always possible.

A seek operation may skip playback positions. The system should not falsely claim that it has captured every part of the video if the user skips ahead.

#### Deduplication

- Assign each capture a stable ID.
- Associate captures with the session and playback timestamp.
- Make retries idempotent where possible.
- Detect near-duplicate captures according to configurable rules.
- Preserve legitimate repeated captures if the user intentionally returns to the same moment.

#### Capture versus note generation

A capture every 30 seconds does **not** require one new note every 30 seconds. Captures are source observations. AI should identify whether each observation introduces a new topic or expands an existing one, while retaining the original capture history and timestamps.

### 5.3 Module C: Screenshot Capture and Management

Screenshots preserve visual information that may not be present in transcript text.

#### Useful visual content

- Slides and diagrams.
- Code samples and terminal output.
- Mathematical formulas.
- Charts, tables, and graphs.
- Software interfaces.
- Architecture illustrations.
- Important visual demonstrations.

#### Screenshot metadata

Each screenshot should be associated with:

- Screenshot ID.
- Session ID.
- Video ID or source URL.
- Playback timestamp.
- Capture time.
- Capture method.
- Image dimensions and format when available.
- Processing status.
- Related capture and note IDs.

#### Capture methods

**Visible-tab capture:** Capture the displayed browser tab. This is useful for an initial prototype and may preserve surrounding page context, but can include irrelevant UI elements and may not correspond to a clean isolated video frame.

**Direct video-frame capture:** Extract the video frame when the player and browser security rules permit it. This generally produces a cleaner result, but requires platform-specific handling and may be blocked by cross-origin restrictions, protected playback, or browser permission constraints.

#### Implementation order

1. Implement visible-tab capture in supported conditions.
2. Add direct video-frame capture for supported players where feasible.
3. Clearly report capture failures rather than silently pretending a screenshot was saved.

Do not bypass DRM or site access restrictions.

#### Image management

- Compress images using configurable quality settings.
- Generate thumbnails for the dashboard.
- Load large images lazily.
- Allow screenshot retention limits.
- Allow users to delete screenshots.
- Preserve screenshots referenced by saved notes unless the user explicitly chooses to remove them.
- Support selective visual analysis so not every screenshot must be sent to an AI provider.

### 5.4 Module D: Transcript and Audio Processing

Transcript text should be the primary source of spoken information, with screenshots providing visual context.

#### Preferred sources

1. Accessible captions or transcripts.
2. User-provided transcript or subtitle files.
3. Supported speech-to-text processing.
4. Visual analysis of screenshots as supplemental context.

Transcript availability varies by video and platform. The extension must not assume every video exposes a transcript.

#### Transcript requirements

- Preserve timestamps where available.
- Divide long transcripts into manageable segments.
- Keep segments in playback order.
- Handle missing timestamps explicitly.
- Remove obvious duplicate segments without losing meaningful repetition.
- Preserve references to source segments used for notes.
- Support languages offered by the selected transcript or transcription provider.

#### Optional speech-to-text

When captions are unavailable, users may enable a compatible cloud transcription service or local speech-recognition model. Audio access depends on the platform and browser capabilities; implementation must use permitted methods and clearly communicate when transcription is unavailable.

#### Text and screenshot alignment

For each capture, the context builder should collect transcript segments overlapping or near the capture timestamp, using a configurable time window. The AI should know the timestamp range of each segment and should not attribute transcript text to a screenshot when the timing is uncertain.

### 5.5 Module E: Pluggable AI Providers

The extension must not depend on a single AI provider.

#### Potential providers

- OpenAI.
- Google Gemini.
- Anthropic Claude.
- Ollama-compatible local models.
- Other compatible AI endpoints.

Provider integrations must be implemented and tested individually. API formats, image support, context limits, structured output, streaming, and costs differ by model.

#### User settings

Users should be able to configure:

- Provider.
- Model.
- API credentials or local endpoint.
- Note-taking style.
- Output language.
- Screenshot-analysis mode.
- Note detail level.
- Topic-merging behavior.
- Code-example generation.
- Revision-question generation.
- Maximum processing frequency.
- Optional usage budget or session limit.

The UI should display models actually available through the configured provider rather than relying only on a permanently hardcoded model list.

#### Capability detection

Each provider adapter should declare support for:

- Text generation.
- Image understanding.
- Structured output.
- Long-context processing.
- Streaming responses.
- Local inference.

If the selected model cannot process images, the system should continue with transcript-based notes and preserve screenshots as attachments.

#### Conceptual provider interface

```typescript
interface AIProvider {
  generateNotes(context: VideoContext): Promise<GeneratedNote[]>;
  analyzeScreenshot(context: ScreenshotContext): Promise<VisualAnalysis>;
  summarizeSession(context: SessionContext): Promise<SessionSummary>;
}
```

These method signatures are illustrative. The implementation must define concrete types, validation, cancellation behavior, errors, and supported capabilities.

### 5.6 Module F: Intelligent Note Generation

The AI should return structured, editable learning notes rather than unformatted prose.

#### Supported note fields

- Title.
- Main explanation.
- Key points.
- Important terminology.
- Examples.
- Code snippets when relevant.
- Start and end timestamps when known.
- Related screenshot IDs.
- Source transcript or capture references.
- Topic tags.
- Confidence or uncertainty information where appropriate.

Not every note needs every field. The structure should adapt to the subject.

#### Quality requirements

The AI should:

- Avoid inventing facts not supported by the captured context.
- Distinguish source statements from inferred explanations.
- Preserve technical detail and important caveats.
- Avoid unnecessary repetition.
- Use clear language suited to the selected note-taking style.
- Keep source timestamps for relevant claims or concepts.
- Mark uncertainty when source evidence is incomplete.
- Preserve code, mathematical expressions, and commands as accurately as possible.
- Avoid claiming that a screenshot contains information that is not visible.

Users must be able to edit, regenerate, merge, split, pin, and delete notes.

### 5.7 Module G: Topic Merging and Context Management

Multiple captures may belong to one continuous explanation. The extension should organize them into coherent notes while preserving capture history.

#### Suggested workflow

1. Store each capture as an independent source observation.
2. Generate an initial interpretation.
3. Compare the interpretation with nearby notes and topics.
4. Decide whether to create a new note or update an existing topic.
5. Preserve all relevant timestamps and screenshot references.
6. Save a new note version when a note changes.
7. Make merges reversible where feasible.

#### Required behavior

- Merge related observations.
- Avoid duplicate concepts.
- Preserve original capture records.
- Allow users to undo a merge or split a note.
- Preserve timestamps when notes are merged.
- Preserve user-edited content.
- Avoid changing unrelated notes automatically.

#### Manual edit protection

If the user edits a note, subsequent AI updates must not silently overwrite the edited content. Track user edits and note versions. When AI changes conflict with manual changes, offer a suggested merge or revision instead of replacing the user's work.

### 5.8 Modules H and I: Popup and Side-Panel Dashboard

#### Popup

Provide quick access to session controls and status.

Example:

```text
AI VIDEO NOTES
────────────────────────
Video: Java JVM Explained
Status: Learning
Capture interval: 30 seconds
Captures: 25
Notes: 8
[ Pause ] [ Capture Now ]
[ Add Quick Note ]
[ Open Dashboard ]
Destination: Obsidian
Sync status: Up to date
```

The interface must show actual operation states and must not claim a capture or synchronization succeeded until success is confirmed.

#### Side panel

The side panel is the primary learning workspace and should remain usable while the user watches the video.

It should include:

- Video title, source, timestamp, and session state.
- Capture and note counts.
- Chronological timeline.
- Topic list and timestamped notes.
- Screenshot viewer.
- Editable note area.
- Personal quick notes.
- Search within a session.
- Ask-AI interface.
- Export controls.
- Destination selection and sync state.
- Clear processing, failure, and retry indicators.

#### User actions

Users should be able to jump to timestamps, capture a moment, edit a note, delete or pin a note, add personal observations, search content, copy or export notes, and select which notes are synchronized.

Avoid disruptive popup notifications during normal playback.

### 5.9 Module J: Configurable Learning Styles

Provide presets such as:

- **Quick Notes:** Short bullet points and definitions.
- **Detailed Learning Notes:** Explanations, examples, terminology, and relationships.
- **Programming Notes:** Code, commands, syntax, errors, solutions, and implementation details.
- **Exam Preparation:** Definitions, key facts, comparisons, and revision questions.
- **Research Notes:** Claims, supporting context, references, and further questions.
- **Custom Instructions:** User-defined note-taking instructions.

Allow users to select a supported output language independently from the source video's language.

### 5.10 Module K: Local-First Storage

The MVP must not require a custom backend.

Use IndexedDB for persistent application data and Chrome Storage for lightweight settings.

#### IndexedDB data

- Learning sessions.
- Captures.
- Transcript segments.
- Generated notes.
- Screenshot blobs and thumbnails.
- Note versions.
- Synchronization queue entries.
- Destination mappings.

#### Chrome Storage data

- Capture interval.
- Preferred provider and model identifier.
- UI preferences.
- Note style.
- Feature toggles.
- Other lightweight settings.

Do not store large screenshot blobs or entire session histories in small settings storage.

#### Storage requirements

- Database versioning and migrations.
- Duplicate prevention.
- Storage usage reporting.
- Configurable retention.
- Recovery from interrupted writes.
- Export and import.
- Safe deletion.
- Warnings when storage is approaching limits.

### 5.11 Modules L and M: Note-Taking Integrations

#### Obsidian integration

Obsidian should be the first dedicated note-taking destination after local storage and Markdown export are working.

Markdown notes should include:

- Video title and URL.
- Timestamped headings.
- AI-generated explanations and key points.
- Tags.
- Screenshot references.
- Personal notes.
- Valid links back to video timestamps.

Example Markdown:

```markdown
---
title: Java JVM Explained
tags:
  - Java
  - JVM
  - Programming
---

# Java JVM Explained

Source: [Watch Video](VIDEO_URL)

## 05:30 — JIT Compiler

The JIT compiler can compile frequently executed code into native machine code.

### Key Points

- JIT means Just-In-Time compilation.
- It can improve runtime performance.

### Screenshot

![JIT Compiler](assets/jit-compiler.png)

[Return to 05:30](VIDEO_TIMESTAMP_URL)
```

Replace example placeholders with real values during export.

A browser extension should not assume that it can freely write arbitrary files into a user's local Obsidian vault. Start with Markdown download/export. For automatic synchronization, implement a local companion app or an Obsidian plugin using a clearly defined communication mechanism.

Automatic synchronization should support choosing the destination, creating and updating notes, saving images alongside Markdown files, tracking stable IDs, preventing duplicate files, and handling renames or deletions safely.

#### Notion integration

Use the official Notion API and supported authorization mechanisms.

Required capabilities:

- Connect an authorized workspace.
- Select a destination page or supported database.
- Create and update pages.
- Organize notes by course, video, or topic.
- Preserve timestamp links.
- Upload or reference screenshots through supported API workflows.
- Track remote identifiers and sync state.
- Handle API limits, authorization failures, and partial uploads.
- Allow users to disconnect the integration.

Verify current Notion API behavior and permissions before implementation; do not assume every type of image or page update is supported identically.

#### Future destinations

The integration architecture should permit future support for Logseq, OneNote, Google Docs, local Markdown folders, and other services with suitable APIs or supported file workflows.

### 5.12 Module N: Reliable Synchronization

Synchronization must be a separate subsystem, not merely an upload button.

#### Responsibilities

- Maintain a queue of pending changes.
- Retry transient failures with bounded backoff.
- Avoid duplicate remote page creation.
- Track remote IDs.
- Detect outdated content where supported.
- Handle deleted or inaccessible destinations.
- Record the last successful synchronization.
- Allow manual retry.
- Report failures clearly.

#### Suggested states

- `pending`
- `syncing`
- `synced`
- `retrying`
- `failed`
- `conflict`

#### Conflict handling

For the first implementation, one-directional synchronization from the extension to a destination is preferable. Bidirectional synchronization should not be added until conflict detection and resolution are designed and tested.

If local and remote versions conflict, never blindly overwrite either side. Give the user a safe resolution path.

### 5.13 Module O: AI Usage and Cost Management

Do not send every screenshot to every AI provider by default.

#### Recommended processing pipeline

1. Capture and persist source information locally.
2. Process available transcript text.
3. Identify potentially important visual content.
4. Send selected screenshots for image analysis when useful.
5. Generate structured notes.
6. Merge related observations.
7. Update the dashboard.
8. Queue destination synchronization.

#### Efficiency features

- Batch transcript segments when appropriate.
- Avoid duplicate AI requests.
- Cache reusable analysis results.
- Support cancellation.
- Limit concurrent requests.
- Track token or usage estimates when the provider exposes them.
- Support optional usage budgets.
- Avoid reanalyzing unchanged screenshots unnecessarily.
- Allow smaller models for suitable tasks.
- Make image-analysis frequency configurable.

#### User controls

- Text-only processing.
- Selective screenshot analysis.
- Full screenshot analysis.
- Manual AI processing.
- Maximum processing frequency.
- Optional session or monthly budget.

Real costs depend on the provider, model, input size, images, and current pricing. Do not imply that cloud AI processing is free unless the provider and account terms actually make it free.

### 5.14 Modules P Through S: Advanced Learning Features

These features should follow the core MVP.

#### Ask AI about the video

Users can ask:

- Explain this concept in simpler language.
- Give me a practical example.
- Compare the concepts discussed.
- Explain the diagram at a particular timestamp.
- What are the most important points?
- What should I revise?

Use relevant transcript segments, screenshots, and saved notes as context. Link answers to timestamps where possible.

#### Revision materials

Optionally generate key takeaways, flashcards, practice questions, multiple-choice questions, interview questions, definitions, revision summaries, and topics for further study. Users must be able to edit and export these materials.

#### Cross-video knowledge connections

Identify related concepts across sessions and suggest links between notes. Suggestions must not silently rewrite unrelated notes.

#### Learning progress

Optional metrics may include sessions, videos studied, notes created, topics covered, and revision activity. Distinguish active playback from paused time. Playback duration must not be presented as proof of attention or learning.

---

## 6. System Architecture

The system should separate video monitoring, capture, AI processing, note management, storage, and destination synchronization into independent modules.

```text
                         USER
                           |
                           v
                  BROWSER EXTENSION
                           |
              +------------+------------+
              |                         |
              v                         v
        VIDEO MONITOR             NOTES DASHBOARD
              |
              v
        CAPTURE SCHEDULER
              |
        +-----+------+
        |            |
        v            v
   TRANSCRIPT     SCREENSHOT
   COLLECTOR      CAPTURE
        |            |
        +------+-----+
               |
               v
         CONTEXT BUILDER
               |
               v
            AI ADAPTER
               |
        +------+----------------+
        |              |        |
        v              v        v
      OPENAI          GEMINI   LOCAL AI
        |              |        |
        +------+-------+--------+
               |
               v
          NOTE PROCESSOR
               |
               v
          LOCAL STORAGE
            INDEXEDDB
               |
               v
        SYNCHRONIZATION
               |
          +----+----+
          |         |
          v         v
       OBSIDIAN   NOTION
```

This is a logical view. The implementation must use browser APIs and permissions appropriate to each operation. The service worker should coordinate tasks, but the extension must not rely on it running continuously.

### Component responsibilities

**Content scripts**
- Detect supported players.
- Monitor playback state and timestamps.
- Collect accessible transcript information.
- Report playback and capture events.

**Service worker**
- Coordinate extension messages.
- Manage supported browser operations.
- Route jobs.
- Handle session lifecycle events.
- Recover state from persistent storage where possible.

**Capture scheduler**
- Schedule playback-aware captures.
- Track expected capture positions.
- Prevent duplicate processing.
- Recover from interruptions.

**AI processing module**
- Build context.
- Select the provider.
- Validate structured output.
- Merge related observations.
- Handle errors and cancellations.

**Storage module**
- Persist sessions, captures, notes, and screenshots.
- Migrate database schemas.
- Manage quotas and retention.
- Support exports and backups.

**Integration module**
- Generate Markdown.
- Synchronize with Notion.
- Communicate with future local companion apps or plugins.

**User interface**
- Popup.
- Side panel.
- Settings page.
- Notes editor.
- Integration configuration.
- Status and error displays.

---

## 7. Recommended Technology Stack

| Component | Technology | Purpose |
|---|---|---|
| Language | TypeScript | Main application code and type safety |
| UI framework | React | Popup, side panel, and settings UI |
| Build tool | Vite | Development and bundling |
| Extension standard | Chrome Extension Manifest V3 | Browser integration |
| Video monitoring | Content scripts and supported player interfaces | Read playback state and timestamps |
| Background coordination | Extension service worker | Message and lifecycle coordination |
| Screenshot capture | Supported Chrome capture APIs | Capture visible tabs or supported frames |
| Local database | IndexedDB | Sessions, screenshots, captures, notes, and queues |
| Settings | Chrome Storage API | Lightweight user preferences |
| AI | Provider adapters | Replaceable model integrations |
| Validation | TypeScript-compatible schema validation library | Validate AI output and data contracts |
| Export | Markdown and JSON | Portability and backups |
| Notion | Official Notion API | Authorized page synchronization |
| Obsidian | Markdown export, then companion app or plugin | Local note workflow |
| Testing | Unit, integration, and browser end-to-end tests | Reliability and regression prevention |
| Version control | Git | Source history and collaboration |

A custom backend is not required for the MVP. A backend can be introduced later for centralized processing, account management, cross-device synchronization, team features, or server-side credential management.

---

## 8. Project Directory Structure

```text
ai-video-notes/
│
├── public/
│   └── manifest.json
│
├── src/
│   ├── background/
│   │   └── service-worker.ts
│   │
│   ├── content/
│   │   ├── video-detector.ts
│   │   ├── playback-monitor.ts
│   │   └── transcript-collector.ts
│   │
│   ├── capture/
│   │   ├── capture-scheduler.ts
│   │   ├── screenshot-capture.ts
│   │   └── timestamp-manager.ts
│   │
│   ├── ai/
│   │   ├── ai-provider.ts
│   │   ├── note-generator.ts
│   │   ├── topic-merger.ts
│   │   └── providers/
│   │       ├── openai-provider.ts
│   │       ├── gemini-provider.ts
│   │       └── ollama-provider.ts
│   │
│   ├── notes/
│   │   ├── note-manager.ts
│   │   ├── markdown-exporter.ts
│   │   └── session-summary.ts
│   │
│   ├── storage/
│   │   ├── indexeddb.ts
│   │   ├── migrations.ts
│   │   └── settings-storage.ts
│   │
│   ├── integrations/
│   │   ├── notion/
│   │   │   └── notion-client.ts
│   │   ├── obsidian/
│   │   │   └── markdown-export.ts
│   │   └── integration-manager.ts
│   │
│   ├── sidepanel/
│   │   ├── App.tsx
│   │   └── components/
│   │
│   ├── popup/
│   │   ├── App.tsx
│   │   └── components/
│   │
│   ├── options/
│   │   └── App.tsx
│   │
│   └── shared/
│       ├── types.ts
│       ├── messages.ts
│       └── constants.ts
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

This is a starting structure, not a rigid requirement. Add modules only when they have a clear responsibility. Keep video capture, AI processing, storage, notes, and integrations independent so future providers or destinations can be added without rewriting the application.

---

## 9. Data Model

Use stable IDs and explicit relationships between sessions, captures, notes, screenshots, and destinations.

### Learning session

```typescript
interface LearningSession {
  id: string;
  videoUrl: string;
  videoTitle: string;
  platform: string;
  startedAt: number;
  endedAt?: number;
  captureIntervalSeconds: number;
  status:
    | "active"
    | "paused"
    | "processing"
    | "completed"
    | "interrupted"
    | "failed";
}
```

### Video capture

```typescript
interface VideoCapture {
  id: string;
  sessionId: string;
  timestampSeconds: number;
  capturedAt: number;
  transcriptSegment?: string;
  screenshotId?: string;
  processingStatus:
    | "pending"
    | "processing"
    | "completed"
    | "failed";
}
```

### Generated note

```typescript
interface GeneratedNote {
  id: string;
  sessionId: string;
  title: string;
  content: string;
  startTimestampSeconds: number;
  endTimestampSeconds?: number;
  tags: string[];
  captureIds: string[];
  screenshotIds: string[];
  userEdited: boolean;
  version: number;
}
```

### Destination synchronization record

```typescript
interface DestinationSync {
  id: string;
  noteId: string;
  destinationType:
    | "obsidian"
    | "notion"
    | "markdown_export";
  remoteId?: string;
  status:
    | "pending"
    | "syncing"
    | "synced"
    | "failed"
    | "conflict";
  lastSyncedAt?: number;
}
```

### Additional entities to include during implementation

- `ScreenshotAsset`: image blob reference, MIME type, dimensions, capture method, and retention state.
- `TranscriptSegment`: session ID, start/end timestamps, text, language when known, and source type.
- `NoteRevision`: note ID, version, timestamp, change source, and content snapshot or safe diff.
- `AIJob`: job ID, source IDs, provider/model, state, attempt count, and error category.
- `IntegrationAccount`: destination type, connection state, and references to securely stored credentials. Never store raw secrets in ordinary note records.

These interfaces are initial examples. Final schemas must include validation, migrations, creation/update timestamps, indexes, and error-handling fields appropriate to the implementation.

---

## 10. AI Context and Processing Pipeline

### Context construction

For each AI job, build a context containing only the information needed for the task:

- Video title and URL.
- Capture timestamp or timestamp range.
- Transcript segments aligned to the capture.
- Screenshot or screenshots selected for analysis.
- Relevant nearby notes and topics.
- User's note-taking style and language preference.
- Applicable constraints, such as concise notes or programming-focused output.

Avoid sending a complete long video transcript or every screenshot repeatedly when a smaller context can do the job.

### Structured output validation

Treat model output as untrusted input. Validate required fields and types before saving. Handle malformed JSON, missing timestamps, oversized content, unsupported formatting, and unexpected output gracefully. If validation fails, retry or present a clear processing error rather than corrupting saved notes.

### Provenance

Each generated note should retain references to the capture IDs and transcript segments used to create it. Where practical, key claims should link to supporting timestamp ranges. AI-generated content should be clearly marked as generated and remain editable.

### Job lifecycle

1. Create a persistent job record.
2. Build context.
3. Call the configured provider.
4. Validate the response.
5. Create or update the note.
6. Mark the job complete.
7. Queue synchronization if enabled.
8. On failure, store an error category and retry state.

Do not depend on an in-memory promise or a continuously running service worker to preserve the job.

---

## 11. Security and Privacy Requirements

Privacy must be part of the original architecture rather than postponed until release.

### Required safeguards

1. No capture before the user starts a session.
2. Clear indicators when capture or AI processing is active.
3. Configurable screenshot capture and retention.
4. Transparent disclosure of data sent to each AI provider.
5. Secure handling of API credentials and integration tokens.
6. Minimal browser permissions.
7. Local export and deletion controls.
8. No hardcoded secrets.
9. Safe communication between extension components.
10. Protection against untrusted webpage content and malicious instructions embedded in transcripts.
11. Error messages that do not leak credentials or unnecessary private content.
12. Clear controls for disconnecting integrations.
13. No attempt to bypass DRM or site access restrictions.
14. Explicit handling of sensitive or private content shown in a video.

### Prompt injection and untrusted content

Transcript text, page content, and screenshots must be treated as source material, not as trusted instructions to the extension. A video or webpage may contain text that asks an AI to reveal secrets or change system behavior. The AI pipeline must not follow instructions embedded in captured content that conflict with the user's settings or application rules.

### Credential handling

Do not embed API keys in source code or build artifacts. For direct API calls, use appropriate extension storage and permissions, and communicate the limitations of client-side credential storage. Do not expose keys to page scripts or arbitrary websites. A future backend can offer server-side credential management but adds hosting and security responsibilities.

### Data disclosure

The settings page should say whether transcript text, screenshots, or other data will be sent to an external provider. If local inference is supported, explain that local execution can improve privacy but still depends on the local environment and any connected services.

---

## 12. Reliability and Error Recovery

### Failure scenarios

- Transcript unavailable.
- Screenshot capture denied or unsupported.
- AI provider unavailable.
- AI response malformed.
- Network interruption.
- Browser restart.
- Extension service worker suspension.
- Notion rate limit reached.
- Destination authorization expires.
- Storage quota reached.
- User closes the video tab.
- Partial synchronization success.

### Required behavior

- Preserve captures already saved locally.
- Mark failed tasks clearly.
- Retry transient failures using bounded exponential backoff or an equivalent policy.
- Do not retry permanent authorization failures indefinitely.
- Prevent duplicate processing when possible.
- Resume pending jobs from persistent state.
- Preserve user-edited notes.
- Allow manual retry.
- Warn about storage limitations before avoidable data loss.
- Distinguish partial success from total failure.

Chrome Extension Manifest V3 service workers can be suspended. Background logic must therefore use persistent state and supported browser lifecycle events rather than assuming a background process runs continuously.

---

## 13. Accessibility and Usability

The extension should remain usable without requiring constant interaction.

### Requirements

- Keyboard-accessible controls.
- Visible focus indicators.
- Readable typography and adequate contrast.
- Screen-reader labels.
- Responsive side-panel layout.
- Clear loading, success, and failure states.
- Searchable notes.
- Simple settings.
- Optional text-size preferences where practical.
- No disruptive repeated notifications during normal playback.

The user should be able to review notes while continuing to watch the video.

---

## 14. Testing Strategy

Testing must verify playback behavior, data integrity, AI quality, and integration reliability—not merely whether a summary is generated.

### Unit tests

Test:

- Timestamp calculations.
- Playback-aware capture scheduling.
- Session state transitions.
- Capture deduplication.
- Note merging and splitting.
- Structured output validation.
- Markdown export.
- Retry behavior.
- Storage migration logic.

### Integration tests

Test:

- Video monitor to capture scheduler.
- Scheduler to local storage.
- Transcript collector to context builder.
- Screenshot records to AI processor.
- AI processor to note manager.
- Note manager to Markdown exporter.
- Note manager to destination synchronization.

### Browser tests

Test on supported video pages under different conditions:

- Normal playback.
- Pause and resume.
- Seeking forward and backward.
- Playback speed changes.
- Fullscreen playback.
- Long videos.
- Video completion.
- Navigation to another video.
- Tab visibility changes.

### Failure tests

Test:

- Missing transcript.
- Screenshot permission failure.
- AI timeout.
- Invalid AI response.
- Network interruption.
- Browser restart.
- Service worker suspension.
- Storage limit reached.
- Failed destination authorization.
- API rate limiting.
- Partial upload.

### Quality evaluation

Evaluate:

- Timestamp accuracy.
- Screenshot relevance.
- Note readability.
- Duplicate-note frequency.
- Preservation of important details.
- Accuracy of code and formulas.
- Source traceability.
- Edit preservation.
- Synchronization correctness.

Use videos from several subjects, not only programming tutorials.

---

## 15. Development Roadmap

Time estimates assume one developer working part-time and are approximate. The work may take longer depending on experience, platform restrictions, and integration complexity.

### Phase 1: Extension foundation — 3–5 days

- Set up TypeScript, React, Vite, and Manifest V3.
- Create the popup interface.
- Detect supported videos.
- Monitor playback state and timestamps.
- Implement session controls.
- Set up basic IndexedDB storage.

**Deliverable:** The extension detects a supported video and tracks a learning session.

### Phase 2: Capture engine — 4–7 days

- Implement playback-aware scheduling.
- Add configurable capture intervals.
- Capture screenshots where supported.
- Associate screenshots with timestamps.
- Store capture history locally.
- Add manual capture.
- Implement deduplication.

**Deliverable:** Timestamped captures and screenshots are stored locally.

### Phase 3: Transcript and AI integration — 5–8 days

- Collect accessible transcripts.
- Define the AI provider interface.
- Integrate one initial provider.
- Generate structured notes.
- Add selected screenshot analysis.
- Validate model output.
- Add editing and basic topic merging.
- Handle errors and retries.

**Deliverable:** Editable AI notes supported by transcript and screenshot context.

### Phase 4: Dashboard and export — 4–6 days

- Build the side panel.
- Add timeline and screenshot viewer.
- Add note editor and timestamp links.
- Add search within a session.
- Build Markdown export.
- Generate a session summary.

**Deliverable:** A complete local learning workflow with portable notes.

### Phase 5: External integrations — 5–10 days

- Implement Notion authorization and destination selection.
- Create and update Notion pages.
- Add stable remote ID mapping.
- Build synchronization queue and retry logic.
- Show synchronization status.
- Design and begin automatic Obsidian synchronization through a companion app or plugin.

**Deliverable:** Notes synchronize with at least one external destination when that integration is complete and authorized. Markdown export remains available independently.

### Phase 6: Reliability, privacy, and release — 4–7 days

- Test browser lifecycle recovery.
- Add storage usage and retention controls.
- Review permissions and credentials.
- Add privacy disclosures.
- Complete automated tests.
- Write setup and user documentation.
- Package the extension for testing and review.

**Deliverable:** A tested build suitable for personal use and further release preparation.

### Overall estimate

Approximately **4–7 weeks for an initial usable MVP and early integrations**, assuming part-time development. A more polished product with robust synchronization, multiple providers, local transcription, additional video platforms, and a companion desktop application will require additional work.

---

## 16. MVP Scope

The MVP should validate the core learning workflow before adding every planned feature.

### Essential MVP features

- Chrome extension using Manifest V3.
- YouTube video detection.
- Start, pause, resume, and stop session controls.
- Automatic captures every 30 seconds of active playback by default.
- Timestamped screenshots where supported.
- Accessible transcript collection.
- One configurable AI provider.
- Structured AI note generation.
- Basic topic merging without losing source references.
- Popup and side-panel dashboard.
- Editable notes.
- Local IndexedDB storage.
- Markdown export compatible with Obsidian.
- Timestamp links and screenshot references.
- Basic retry and recovery behavior.
- Explicit capture and privacy controls.

### Later releases

- Notion synchronization.
- Automatic Obsidian synchronization.
- Multiple cloud AI providers.
- Local AI integration.
- Speech-to-text fallback.
- Advanced topic merging.
- Cross-video knowledge connections.
- Flashcards and quizzes.
- Learning analytics.
- Additional video platforms.
- Companion desktop application.
- Cross-device synchronization.

The MVP should remain usable even if none of the optional integrations are configured.

---

## 17. Acceptance Criteria

The MVP is successful when all of the following can be demonstrated:

1. A user can open a supported YouTube video and start a learning session.
2. The extension tracks the current playback position.
3. Captures occur at the configured interval of active playback.
4. Pausing the video stops scheduled captures.
5. Seeking updates the capture position correctly.
6. Available transcript segments are associated with timestamps.
7. Screenshots are captured where browser permissions and platform restrictions allow.
8. Captures are stored locally before AI processing.
9. The selected AI model generates structured notes.
10. Related observations can be merged without losing source references.
11. The user can edit generated notes.
12. The dashboard displays notes, screenshots, and timestamps.
13. Timestamp links return the user to the relevant video position where supported.
14. Notes can be exported as Markdown.
15. Markdown exports retain applicable screenshot references.
16. Interrupted AI requests do not destroy existing notes.
17. Retries do not create unnecessary duplicate records.
18. The user can control capture, processing, and data retention.
19. Errors are visible and recoverable.
20. The extension works without a custom backend.

Each external integration must have its own acceptance tests before it is considered production-ready.

---

## 18. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| A site does not expose captions | Support user-provided transcripts and optional permitted speech-to-text workflows. |
| Direct frame extraction is blocked | Use visible-tab capture where permitted and report when screenshot capture is unavailable. |
| Repetitive notes | Use topic merging while preserving source captures. |
| Incorrect timestamps | Use actual media playback positions and test seeking and playback speed changes. |
| AI produces unsupported claims | Retain source references, validate output, show uncertainty, and allow editing. |
| AI requests become expensive | Use batching, selective image analysis, caching, and optional usage budgets. |
| Browser background tasks stop | Persist task state and design around service worker suspension. |
| Duplicate remote pages | Track stable local IDs and remote destination IDs. |
| User edits are overwritten | Track note versions and protect manually edited content. |
| Local storage fills up | Show usage, allow retention controls, and support export and deletion. |
| Credential exposure | Avoid hardcoded keys, minimize permissions, and keep secrets away from page scripts. |
| Destination API changes | Isolate integrations and verify the current official API before implementation. |
| Captured content contains malicious instructions | Treat transcripts and webpage content as untrusted source material. |
| Sync fails midway | Persist job state, retry safely, and report partial success. |

---

## 19. Future Product Direction

After the MVP is stable, the project can expand into a broader learning platform with:

- A desktop companion for Obsidian and local file synchronization.
- A knowledge graph connecting concepts across videos.
- Automatic revision scheduling.
- Flashcards, quizzes, and practical exercises.
- Local model support.
- Multi-device synchronization.
- Search across all learning sessions.
- Optional learning analytics.
- More browser and video-platform integrations.
- A standalone web dashboard.

These features should build on the same session, capture, note, storage, and integration architecture rather than creating a separate implementation of core functionality.

---

## 20. Final Implementation Decisions

The initial implementation will use the following choices:

| Decision | Selected approach |
|---|---|
| Primary product | Browser extension |
| Initial browser | Chrome and compatible Chromium browsers |
| Extension architecture | Manifest V3 |
| Frontend | TypeScript, React, and Vite |
| Initial video platform | YouTube |
| Default capture interval | 30 seconds of active playback |
| Transcript source | Accessible captions or transcripts when available |
| Visual source | Timestamped screenshots where supported |
| AI architecture | Replaceable provider adapter |
| First AI integration | One selected provider, with others added later |
| Local persistence | IndexedDB |
| Settings persistence | Chrome Storage API |
| Primary UI | Popup and side-panel dashboard |
| First export format | Markdown with timestamp links and screenshot references |
| First note workflow | Obsidian-compatible Markdown export |
| Next external integration | Notion API |
| Custom backend | Not required for the MVP |

### Build order

1. Video detection and session state.
2. Playback-aware capture scheduling.
3. Screenshot and transcript capture.
4. Reliable local persistence.
5. One AI provider and structured note generation.
6. Side-panel notes dashboard and editing.
7. Markdown export.
8. External integrations.
9. Advanced learning features.

The first development milestone is a working extension that detects a supported YouTube video, tracks playback, captures timestamped information every 30 seconds, and stores those captures locally. Once that foundation is reliable, add AI note generation, the live dashboard, Markdown export, and external integrations in sequence.

---

## 21. Implementation Checklist

Use this checklist during development.

### Foundation

- [ ] Create the repository and initialize Git.
- [ ] Set up TypeScript, React, Vite, and Manifest V3.
- [ ] Configure popup, side panel, content scripts, and service worker.
- [ ] Define shared types and extension message contracts.
- [ ] Implement session state and persistence.

### Capture

- [ ] Detect supported YouTube video players.
- [ ] Read playback timestamps and state.
- [ ] Implement configurable playback-aware scheduling.
- [ ] Add manual capture.
- [ ] Implement permitted screenshot capture.
- [ ] Collect accessible transcript segments.
- [ ] Save captures and metadata to IndexedDB.
- [ ] Prevent duplicate capture records.
- [ ] Test pause, seek, resume, and video navigation.

### AI and notes

- [ ] Define provider adapter interface.
- [ ] Implement one provider.
- [ ] Validate AI output schemas.
- [ ] Generate timestamped structured notes.
- [ ] Associate source capture and transcript IDs.
- [ ] Implement basic topic merging.
- [ ] Protect manual edits.
- [ ] Add error handling and retry state.

### User interface

- [ ] Build popup session controls.
- [ ] Build side-panel timeline.
- [ ] Add screenshot viewer.
- [ ] Add editable notes.
- [ ] Add quick notes and manual capture.
- [ ] Add search and status indicators.
- [ ] Add provider and note-style settings.

### Export and integrations

- [ ] Export Markdown notes.
- [ ] Include timestamps and video links.
- [ ] Include screenshot assets or clear references to exported assets.
- [ ] Test opening exported notes in Obsidian.
- [ ] Implement Notion integration after export is stable.
- [ ] Track destination IDs and synchronization status.
- [ ] Add bounded retries and conflict handling.

### Security and release readiness

- [ ] Review browser permissions.
- [ ] Ensure no API keys are hardcoded.
- [ ] Add clear privacy disclosures.
- [ ] Add data deletion and retention controls.
- [ ] Test service worker suspension and browser restart.
- [ ] Test storage limits and recovery.
- [ ] Complete unit, integration, and end-to-end tests.
- [ ] Write setup, troubleshooting, and user documentation.
- [ ] Prepare a release build and conduct a final permissions review.

---

## Conclusion

AI Video Notes should be developed as a **local-first, AI-powered video learning assistant** with reliable timestamped capture, transcript and screenshot context, structured editable notes, portable Markdown export, and modular integrations.

The best first release is intentionally focused: YouTube support, 30-second playback-aware captures, accessible transcript collection, one configurable AI provider, IndexedDB storage, an editable side-panel dashboard, and Markdown export. Once that workflow is stable, the project can grow to support Notion, automatic Obsidian synchronization, additional models, local transcription, knowledge connections, and revision tools without redesigning the foundation.
