import type { ExtensionMessage, ExtensionResponse } from './models'

export async function sendExtensionMessage(
  message: ExtensionMessage,
): Promise<ExtensionResponse> {
  const response = await chrome.runtime.sendMessage<ExtensionMessage, ExtensionResponse>(message)
  if (!response?.success) {
    throw new Error(response?.error ?? 'The extension could not complete that action.')
  }
  return response
}

export async function connectCurrentPage(): Promise<ExtensionResponse> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id || !tab.url) throw new Error('The active browser tab is unavailable.')

  const url = new URL(tab.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Open a video on an http or https page to connect it.')
  }
  try {
    const hasOrigin = await chrome.permissions.contains({ origins: [`${url.origin}/*`] })
    if (!hasOrigin) {
      const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] })
      if (!granted) throw new Error('Site access was not granted. Allow access to this page to connect its video.')
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Site access was not granted')) throw error
  }

  return sendExtensionMessage({ type: 'PAGE_CONNECT' })
}

export function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const remainingSeconds = seconds % 60
  const time = `${minutes.toString().padStart(hours > 0 ? 2 : 1, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
  return hours > 0 ? `${hours}:${time}` : time
}
