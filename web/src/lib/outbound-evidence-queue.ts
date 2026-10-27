export type PendingOutboundEvidence = {
  id: string
  auditId: string
  scanId: string
  blob: Blob
  width: number
  height: number
  capturedAt: string
}

const databaseName = "dataplus-outbound-evidence"
const storeName = "pending-photos"

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("Offline photo queue is unavailable in this browser."))
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("Unable to open the package photo queue."))
  })
}

function transactionRequest<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  return openDatabase().then(database => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const request = action(transaction.objectStore(storeName))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("Package photo queue operation failed."))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error("Package photo queue transaction failed.")) }
  }))
}

export function savePendingOutboundEvidence(item: PendingOutboundEvidence) {
  return transactionRequest<IDBValidKey>("readwrite", store => store.put(item))
}

export function removePendingOutboundEvidence(id: string) {
  return transactionRequest<undefined>("readwrite", store => store.delete(id))
}

export function listPendingOutboundEvidence() {
  return transactionRequest<PendingOutboundEvidence[]>("readonly", store => store.getAll())
}
