import type { GeneratedNote, LearningSession, VideoCapture } from './models'

const DATABASE_NAME = 'ai-video-notes'
const DATABASE_VERSION = 1

let databasePromise: Promise<IDBDatabase> | undefined

function openDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

      request.onupgradeneeded = () => {
        const database = request.result
        const sessions = database.createObjectStore('sessions', { keyPath: 'id' })
        sessions.createIndex('startedAt', 'startedAt')

        const captures = database.createObjectStore('captures', { keyPath: 'id' })
        captures.createIndex('sessionId', 'sessionId')

        const notes = database.createObjectStore('notes', { keyPath: 'id' })
        notes.createIndex('sessionId', 'sessionId')
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Could not open local note storage.'))
    })
  }

  return databasePromise
}

async function requestFromStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const request = createRequest(transaction.objectStore(storeName))

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error(`Could not access ${storeName}.`))
    transaction.onabort = () => reject(transaction.error ?? new Error(`The ${storeName} transaction was aborted.`))
  })
}

export function saveSession(session: LearningSession): Promise<IDBValidKey> {
  return requestFromStore('sessions', 'readwrite', (store) => store.put(session))
}

export function getSession(id: string): Promise<LearningSession | undefined> {
  return requestFromStore('sessions', 'readonly', (store) => store.get(id))
}

export async function listSessions(): Promise<LearningSession[]> {
  const sessions = await requestFromStore<LearningSession[]>('sessions', 'readonly', (store) => store.getAll())
  return sessions.sort((left, right) => right.startedAt - left.startedAt)
}

export function saveCapture(capture: VideoCapture): Promise<IDBValidKey> {
  return requestFromStore('captures', 'readwrite', (store) => store.put(capture))
}

export async function listCaptures(sessionId: string): Promise<VideoCapture[]> {
  const captures = await requestFromStore<VideoCapture[]>(
    'captures',
    'readonly',
    (store) => store.index('sessionId').getAll(sessionId),
  )
  return captures.sort((left, right) => left.timestampSeconds - right.timestampSeconds)
}

export function saveNote(note: GeneratedNote): Promise<IDBValidKey> {
  return requestFromStore('notes', 'readwrite', (store) => store.put(note))
}

export async function listNotes(sessionId: string): Promise<GeneratedNote[]> {
  const notes = await requestFromStore<GeneratedNote[]>(
    'notes',
    'readonly',
    (store) => store.index('sessionId').getAll(sessionId),
  )
  return notes.sort((left, right) => left.startTimestampSeconds - right.startTimestampSeconds)
}

export function deleteNote(id: string): Promise<void> {
  return requestFromStore('notes', 'readwrite', (store) => store.delete(id))
}

export function deleteCapture(id: string): Promise<void> {
  return requestFromStore('captures', 'readwrite', (store) => store.delete(id))
}

export async function deleteSession(sessionId: string): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['sessions', 'captures', 'notes'], 'readwrite')
    transaction.objectStore('sessions').delete(sessionId)

    const captureIndex = transaction.objectStore('captures').index('sessionId')
    const captureReq = captureIndex.getAllKeys(sessionId)
    captureReq.onsuccess = () => {
      for (const key of captureReq.result) {
        transaction.objectStore('captures').delete(key)
      }
    }

    const noteIndex = transaction.objectStore('notes').index('sessionId')
    const noteReq = noteIndex.getAllKeys(sessionId)
    noteReq.onsuccess = () => {
      for (const key of noteReq.result) {
        transaction.objectStore('notes').delete(key)
      }
    }

    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not delete session.'))
  })
}
