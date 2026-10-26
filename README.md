<div align="center">

  <img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=12,23,38,45&height=220&section=header&text=AI%20Video%20Notes&fontSize=46&fontColor=ffffff&fontAlignY=40&desc=Local-First%20Study%20Companion%20%7C%20Direct%20Canvas%20Capture%20%7C%20Multimodal%20AI%20Vision&descAlignY=64&descAlign=50" width="100%" alt="AI Video Notes Header" />

  <p align="center">
    <code>&gt; Real-time visual lecture synthesis &bull; High-yield structured study notes &bull; 100% private</code>
  </p>

  <p align="center">
    <a href="#04-quick-start--setup"><img src="https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Extension" /></a>
    <a href="#02-technical-stack"><img src="https://img.shields.io/badge/Backend-Spring_Boot_4_%7C_Java_25-6DB33F?style=for-the-badge&logo=springboot&logoColor=white" alt="Spring Boot" /></a>
    <a href="#02-technical-stack"><img src="https://img.shields.io/badge/Frontend-React_19_%7C_TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
    <a href="#02-technical-stack"><img src="https://img.shields.io/badge/AI_Vision-Gemini_%7C_OpenAI_%7C_Claude-8E75C2?style=for-the-badge&logo=googlegemini&logoColor=white" alt="AI Vision" /></a>
    <a href="#05-architecture--security"><img src="https://img.shields.io/badge/Security-Windows_Credential_Manager-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows Credential Manager" /></a>
  </p>

</div>

---

## 01 About

**AI Video Notes** is an intelligent, local-first Chrome extension and background daemon designed for **YouTube, AWS Skill Builder, Coursera, Oracle Academy**, and any web page hosting an HTML5 video player.

While watching lectures, certification courses, or technical tutorials, the extension autonomously captures timestamped moments, extracts video frames directly from the player via in-memory `<canvas>` rendering, collects captions or subtitles, and synthesizes clear, high-yield study notes with visual slide grounding.

<table>
  <tr>
    <td width="30%"><strong>Architecture</strong></td>
    <td>Local-First (Chrome Manifest V3 Extension + Local Spring Boot Daemon)</td>
  </tr>
  <tr>
    <td><strong>Storage</strong></td>
    <td>100% Local (Browser IndexedDB &bull; Windows Credential Manager for API Keys)</td>
  </tr>
  <tr>
    <td><strong>Vision Pipeline</strong></td>
    <td>Direct canvas frame extraction &bull; In-memory base64 multimodal processing</td>
  </tr>
  <tr>
    <td><strong>Platforms Tested</strong></td>
    <td>YouTube, AWS Skill Builder, Coursera, Oracle University &amp; generic HTML5 players</td>
  </tr>
  <tr>
    <td><strong>Export Formats</strong></td>
    <td>Structured Markdown document + full-resolution timestamped frame screenshots (ZIP)</td>
  </tr>
</table>

---

## 02 Technical Stack

<div align="center">

### Backend &amp; Core
<p align="center">
  <img src="https://img.shields.io/badge/Java_25-ED8B00?style=for-the-badge&logo=openjdk&logoColor=white" alt="Java 25" />
  <img src="https://img.shields.io/badge/Spring_Boot_4-6DB33F?style=for-the-badge&logo=springboot&logoColor=white" alt="Spring Boot 4" />
  <img src="https://img.shields.io/badge/Spring_WebMVC-6DB33F?style=for-the-badge&logo=spring&logoColor=white" alt="Spring WebMVC" />
  <img src="https://img.shields.io/badge/JNA_Platform-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="JNA Platform" />
  <img src="https://img.shields.io/badge/Jackson_JSON-2D3748?style=for-the-badge&logo=json&logoColor=white" alt="Jackson" />
  <img src="https://img.shields.io/badge/Apache_Maven-C71A36?style=for-the-badge&logo=apachemaven&logoColor=white" alt="Maven" />
</p>

### Frontend Extension
<p align="center">
  <img src="https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript_5-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite_8-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Extension" />
  <img src="https://img.shields.io/badge/IndexedDB-F16529?style=for-the-badge&logo=html5&logoColor=white" alt="IndexedDB" />
  <img src="https://img.shields.io/badge/JSZip-2D3748?style=for-the-badge&logo=files&logoColor=white" alt="JSZip" />
</p>

### Multimodal AI &amp; Vision
<p align="center">
  <img src="https://img.shields.io/badge/Google_Gemini-8E75C2?style=for-the-badge&logo=googlegemini&logoColor=white" alt="Google Gemini" />
  <img src="https://img.shields.io/badge/OpenAI_GPT--4o-412991?style=for-the-badge&logo=openai&logoColor=white" alt="OpenAI" />
  <img src="https://img.shields.io/badge/Anthropic_Claude-D97706?style=for-the-badge&logo=anthropic&logoColor=white" alt="Anthropic Claude" />
  <img src="https://img.shields.io/badge/OpenAI_Whisper-00A67E?style=for-the-badge&logo=openai&logoColor=white" alt="OpenAI Whisper" />
</p>

</div>

---

## 03 Key Features &amp; Pipeline

- **Direct Canvas Video Frame Extraction**:
  - Draws frames directly from the `<video>` element into an in-memory `<canvas>` across all parent frames and iframes.
  - **Works seamlessly even when the video tab is in the background** or when switching between windows.
  - Eliminates browser address bars, tabs, borders, and letterbox black bars.

- **Multimodal Slide Reading**:
  - Automatically sends captured slide frames to **Google Gemini**, **OpenAI GPT-4o**, or **Anthropic Claude**.
  - Reads slide headings, bullet points, architecture diagrams, CLI commands, and code snippets directly from the screen image.
  - Zero hallucinations — strictly grounded in visual slide content and lecture audio.

- **Smart Platform &amp; Course Recognition**:
  - Intelligently parses real course slugs from complex LMS URLs and referrer parameters (e.g. `aws-cloud-practitioner-essentials` &rarr; `AWS Cloud Practitioner Essentials`).
  - Automatically suppresses internal video player shell names (e.g. *"Levitate Learning Experience"* on AWS Skill Builder).
  - Inspects live DOM breadcrumbs, module headings, and lesson titles.

- **Interactive Study Dashboard**:
  - **Timeline &amp; Document Views**: Switch instantly between chronological study cards and a unified markdown summary document.
  - **Seamless Navigation**: Return to **Home / All Notes** at any time without deleting or losing notes.
  - **Inline Title Editing (✎)**: Rename any course or lecture title inline.
  - **Timestamp Video Seek**: Click any timestamp pill in your notes to jump directly to that exact second in the active video tab.
  - **One-Click ZIP Export**: Export formatted Markdown study notes bundled with all captured slide screenshots.

- **Audio Transcription Fallback**:
  - Optional tab-audio capture utilizing OpenAI Whisper when web videos do not provide captions or subtitle tracks.

---

## 04 Quick Start &amp; Setup

### Prerequisites

- **Google Chrome** (v116 or newer)
- **Node.js** (v22.12 or newer) &amp; **npm**
- **Java 25** (JDK 25)
- **Windows** (for secure DPAPI / Windows Credential Manager integration)

---

### Step 1: Start the Local Spring Boot API

From the repository root, open PowerShell:

```powershell
.\backend\mvnw.cmd -f backend\pom.xml spring-boot:run
```

> **Note:** The daemon binds to `http://127.0.0.1:8080`. Keep this process running in the background while using the extension. It securely stores your provider API keys inside your current Windows account's Credential Manager.

---

### Step 2: Build &amp; Load the Chrome Extension

In a separate PowerShell terminal:

```powershell
cd extension
npm install
npm run build
```

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the `extension/dist` folder.

---

### Step 3: Configure Your AI Provider

1. Open the extension side panel or dashboard by clicking the extension icon.
2. Click the **Settings (⚙)** icon.
3. Select your preferred provider (**Google Gemini**, **OpenAI**, or **Anthropic Claude**).
4. Enter your API key and click **Save**. The local API validates your key against the provider before securely storing it.

---

### Step 4: Capture &amp; Study

1. Open any video lecture on **YouTube, AWS Skill Builder, Coursera**, or another course website.
2. Open the extension and click **Connect this page**.
3. Choose your desired capture interval (e.g. 15s, 30s, 60s) and click **Start session**.
4. Learn with complete focus — notes and screenshots are organized automatically in real time!

---

## 05 Architecture &amp; Security

```
+-----------------------------------------------------------------------------------+
|                                  BROWSER TAB                                      |
|                                                                                   |
|  [ HTML5 Video Element ] --- <canvas> Frame Grab ----+                            |
|  [ Captions / Subtitles ] -- DOM & TextTrack Cue ----+                            |
|                                                      |                            |
|                                                      v                            |
|                                     +----------------------------------+          |
|                                     |    CHROME EXTENSION (MV3)        |          |
|                                     |  - Content Script                |          |
|                                     |  - Service Worker Background     |          |
|                                     |  - IndexedDB Local Storage       |          |
|                                     +-----------------+----------------+          |
+-------------------------------------------------------|---------------------------+
                                                        |
                                       POST /api/notes/generate
                                       (Local HTTP Payload)
                                                        |
                                                        v
+-----------------------------------------------------------------------------------+
|                        LOCAL BACKEND DAEMON (127.0.0.1:8080)                     |
|                                                                                   |
|  [ Spring Boot 4 REST API ]                                                       |
|             |                                                                     |
|             +--- Windows Credential Manager (DPAPI Key Security)                  |
|             |                                                                     |
|             +--- Multimodal AI Vision Clients                                     |
|                     |                                                             |
|                     +---> Google Gemini API (inlineData JPEG)                     |
|                     +---> OpenAI API (gpt-4o Vision / Whisper)                    |
|                     +---> Anthropic API (Claude 3.5 Sonnet Vision)                |
+-----------------------------------------------------------------------------------+
```

### Privacy Guarantees

- **Zero Cloud Key Storage**: API keys never leave your machine; they are encrypted via Windows Data Protection API (DPAPI) and stored in Windows Credential Manager.
- **No Third-Party Analytics**: No telemetry, analytics, or tracking scripts are included.
- **Local Database**: All notes, transcripts, and images reside strictly inside your browser's private IndexedDB until you choose to export them.

---

<div align="center">

  <p>
    <strong>I prefer to understand what I'm building.</strong>
  </p>

  <img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=12,23,38,45&height=100&section=footer" width="100%" alt="AI Video Notes Footer" />

</div>
