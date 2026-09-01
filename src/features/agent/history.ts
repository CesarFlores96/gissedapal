import type { AgentConversation } from "./types"

const DATABASE_NAME = "sedapalgis-agent"
const STORE_NAME = "conversations"
const DATABASE_VERSION = 1
const MAX_CONVERSATIONS = 20
const MAX_MESSAGES = 50
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" })
        store.createIndex("userId", "userId", { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir el historial."))
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("No se pudo acceder al historial."))
  })
}

async function conversationsForUser(database: IDBDatabase, userId: string): Promise<AgentConversation[]> {
  const transaction = database.transaction(STORE_NAME, "readonly")
  const index = transaction.objectStore(STORE_NAME).index("userId")
  return requestResult(index.getAll(IDBKeyRange.only(userId)))
}

export async function listConversations(userId: string): Promise<AgentConversation[]> {
  const database = await openDatabase()
  try {
    const cutoff = Date.now() - RETENTION_MS
    const conversations = await conversationsForUser(database, userId)
    const expired = conversations.filter((item) => item.updatedAt < cutoff)
    if (expired.length) {
      const transaction = database.transaction(STORE_NAME, "readwrite")
      for (const item of expired) transaction.objectStore(STORE_NAME).delete(item.id)
    }
    return conversations
      .filter((item) => item.updatedAt >= cutoff)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_CONVERSATIONS)
  } finally {
    database.close()
  }
}

export async function saveConversation(conversation: AgentConversation): Promise<AgentConversation> {
  const database = await openDatabase()
  const normalized = {
    ...conversation,
    title: conversation.title.trim().slice(0, 80) || "Nueva consulta",
    messages: conversation.messages.slice(-MAX_MESSAGES),
    updatedAt: Date.now(),
  }
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite")
    await requestResult(transaction.objectStore(STORE_NAME).put(normalized))
    const conversations = await conversationsForUser(database, conversation.userId)
    const overflow = conversations
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(MAX_CONVERSATIONS)
    if (overflow.length) {
      const cleanup = database.transaction(STORE_NAME, "readwrite")
      for (const item of overflow) cleanup.objectStore(STORE_NAME).delete(item.id)
    }
    return normalized
  } finally {
    database.close()
  }
}

export async function deleteConversation(id: string, userId: string): Promise<void> {
  const database = await openDatabase()
  try {
    const read = database.transaction(STORE_NAME, "readonly")
    const existing = await requestResult<AgentConversation | undefined>(read.objectStore(STORE_NAME).get(id))
    if (existing?.userId === userId) {
      const write = database.transaction(STORE_NAME, "readwrite")
      await requestResult(write.objectStore(STORE_NAME).delete(id))
    }
  } finally {
    database.close()
  }
}

export async function clearConversations(userId: string): Promise<void> {
  const database = await openDatabase()
  try {
    const conversations = await conversationsForUser(database, userId)
    const transaction = database.transaction(STORE_NAME, "readwrite")
    for (const item of conversations) transaction.objectStore(STORE_NAME).delete(item.id)
  } finally {
    database.close()
  }
}
