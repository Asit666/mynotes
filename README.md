# AI Video Notes

AI Video Notes is a local-first Chrome study extension for YouTube, Coursera,
AWS Skill Builder, Oracle Academy, and other web pages that expose an HTML5
video player. It captures timestamped video moments, reads available captions
or visible transcripts, optionally transcribes tab audio when captions are
missing, and generates editable study notes.

## Requirements

- Google Chrome 116 or newer
- Node.js 22.12 or newer and npm
- Java 25
- Windows for saving provider keys in Windows Credential Manager
- An API key from any provider you intend to use; OpenAI is required for the
  optional audio-transcription fallback

## Start the local API

From the repository root, in PowerShell:

```powershell
.\backend\mvnw.cmd -f backend\pom.xml spring-boot:run
```

The API binds to `127.0.0.1:8080`. Keep it running while using the extension.
It stores provider keys in the current Windows account's Credential Manager;
keys are not written to extension storage, returned by the API, or committed to
the repository.

## Build and load the extension

```powershell
Set-Location extension
npm install
npm run build
```

In Chrome, open `chrome://extensions`, enable **Developer mode**, select **Load
unpacked**, and choose `extension\dist`.

## Connect a course page

1. Open a video in YouTube, Coursera, AWS Skill Builder, Oracle Academy, or
   another `http`/`https` page.
2. Open the extension and select **Connect this page**. Chrome asks for access
   to that site; access is requested per site, not for every website at install.
3. Select a capture interval and start a study session. Captures, notes,
   screenshots, and quick notes are stored in the browser's local IndexedDB.
4. Open the side panel to review, edit, retry failed AI notes, and export a
   Markdown-and-screenshot ZIP.

The extension looks for rendered YouTube transcript segments, native HTML5 text
tracks/caption cues, and visible transcript/subtitle elements on course pages.
Site player markup varies, so use the site's own captions or transcript panel
when available.

## AI providers and models

Open the side-panel **Settings**:

1. Choose **OpenAI**, **Anthropic Claude**, or **Google Gemini**.
2. Enter that provider's API key and save it. The local API validates the key
   by loading models available to that account before saving it in Windows
   Credential Manager. An invalid key is not saved.
3. A compatible model is selected automatically after validation. The model
   field also accepts a model ID manually or uses **Load available models** to
   refresh the list.

Keys are provider-account credentials, not MCP credentials. Do not put them in
source files, the extension, or chat messages. The extension sends note
generation requests to the local API; the API contacts the selected provider.
MCP is a separate tool-server protocol and requires a configured MCP endpoint;
it cannot validate or replace provider API keys.

## Optional audio transcription

Audio fallback is **off by default**. Before starting a session, opt in to
**Transcribe audio when captions are unavailable**. Chrome then asks for
tab-audio capture permission. The extension records tab audio while opted in,
but sends a short segment to OpenAI's transcription API only when the current
capture has no available caption/transcript text. This uses your OpenAI account
and may incur API charges. Browser playback audio continues while capture is
active. Pausing/finishing a session stops or pauses audio recording.

If transcription fails after an audio segment was captured, that segment is
kept locally with the failed capture so you can retry after fixing the provider
configuration. Successful audio is not retained in the notes database or ZIP.

## Important limits and privacy

- There is no universal transcript API for every course website. Capture works
  with accessible HTML5 players and text exposed by the page; pages with
  proprietary players, inaccessible captions, cross-origin restrictions, or
  DRM may not expose transcript text. The extension does not bypass DRM, logins,
  or site access controls.
- Without captions or transcript text, AI notes require the explicit audio
  fallback opt-in and a configured OpenAI key. Otherwise the capture remains
  available for screenshots and manual notes.
- Screenshots capture the visible browser tab and may include other page
  content. Review captures before exporting or sharing them.
- When AI generation is enabled, transcript text is sent to the provider you
  selected. With audio fallback, only the opted-in short audio interval lacking
  captions is sent to OpenAI for transcription.
- Video tabs are accessed only after you connect a specific site. API keys
  remain in the current Windows user's Credential Manager and are never
  returned to the extension.
- Session data stays in local browser storage unless you export it.

## Checks

```powershell
Set-Location extension
npm run build
npm run lint
Set-Location ..\backend
.\mvnw.cmd test
```
