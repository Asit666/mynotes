import type { ExtensionMessage, ExtensionResponse } from './models'

let recorder: MediaRecorder | undefined
let mediaStream: MediaStream | undefined
let audioContext: AudioContext | undefined
let pendingChunks: Blob[] = []
let flushResolver: ((audioBase64: string) => void) | undefined
let flushRejecter: ((error: Error) => void) | undefined
let flushTimer: number | undefined

function clearFlush() {
  if (flushTimer) window.clearTimeout(flushTimer)
  flushTimer = undefined
  flushResolver = undefined
  flushRejecter = undefined
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('The captured audio could not be read.'))
        return
      }
      resolve(reader.result.slice(reader.result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('The captured audio could not be read.'))
    reader.readAsDataURL(blob)
  })
}

function resolveFlush(audioBase64: string) {
  if (!flushResolver) return
  const resolve = flushResolver
  clearFlush()
  resolve(audioBase64)
}

function rejectFlush(error: Error) {
  if (!flushRejecter) return
  const reject = flushRejecter
  clearFlush()
  reject(error)
}

async function flushAudio(): Promise<string> {
  if (!recorder || recorder.state !== 'recording') return ''
  if (flushResolver) throw new Error('The previous audio segment is still being prepared.')
  const result = new Promise<string>((resolve, reject) => {
    flushResolver = resolve
    flushRejecter = reject
    flushTimer = window.setTimeout(() => {
      void blobToBase64(new Blob(pendingChunks, { type: recorder?.mimeType || 'audio/webm' }))
        .then(resolveFlush)
        .catch((error: unknown) => rejectFlush(error instanceof Error ? error : new Error('The recorded audio could not be read.')))
    }, 3000)
  })
  recorder.requestData()
  return result
}

async function startCapture(streamId: string): Promise<void> {
  if (recorder) throw new Error('Audio capture is already running.')
  try {
    const constraints = {
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    } as MediaStreamConstraints
    mediaStream = await navigator.mediaDevices.getUserMedia(constraints)
    audioContext = new AudioContext()
    const source = audioContext.createMediaStreamSource(mediaStream)
    source.connect(audioContext.destination)
    await audioContext.resume()
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    recorder = new MediaRecorder(mediaStream, { mimeType })
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) pendingChunks.push(event.data)
      if (flushResolver) {
        const audio = new Blob(pendingChunks, { type: recorder?.mimeType || mimeType })
        pendingChunks = []
        void blobToBase64(audio).then(resolveFlush).catch((error: unknown) => {
          rejectFlush(error instanceof Error ? error : new Error('The recorded audio could not be read.'))
        })
      }
    })
    recorder.addEventListener('error', () => rejectFlush(new Error('The browser audio recorder failed.')))
    recorder.start()
  } catch (error) {
    await stopCapture()
    throw error
  }
}

async function pauseCapture(): Promise<void> {
  if (!recorder || recorder.state !== 'recording') return
  await flushAudio()
  pendingChunks = []
  recorder.pause()
}

async function stopCapture(): Promise<void> {
  try {
    if (recorder) {
      if (recorder.state === 'recording') {
        await flushAudio()
        recorder.stop()
      } else if (recorder.state === 'paused') {
        recorder.stop()
      }
    }
  } finally {
    recorder = undefined
    mediaStream?.getTracks().forEach((track) => track.stop())
    mediaStream = undefined
    if (audioContext) await audioContext.close()
    audioContext = undefined
    pendingChunks = []
    if (flushResolver) resolveFlush('')
    if (flushRejecter) rejectFlush(new Error('Audio capture stopped before the segment was ready.'))
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  const action = async (): Promise<ExtensionResponse> => {
    switch (message.type) {
      case 'AUDIO_START':
        await startCapture(message.streamId)
        return { success: true }
      case 'AUDIO_FLUSH':
        return { success: true, audioBase64: await flushAudio() }
      case 'AUDIO_PAUSE':
        await pauseCapture()
        return { success: true }
      case 'AUDIO_RESUME':
        if (!recorder || recorder.state !== 'paused') throw new Error('The audio recorder is not paused.')
        recorder.resume()
        return { success: true }
      case 'AUDIO_STOP':
        await stopCapture()
        return { success: true }
      default:
        throw new Error('This message is not supported by the audio recorder.')
    }
  }

  if (!message.type.startsWith('AUDIO_')) return
  void action().then(sendResponse).catch((error: unknown) => {
    sendResponse({ success: false, error: error instanceof Error ? error.message : 'Audio capture failed.' } satisfies ExtensionResponse)
  })
  return true
})
