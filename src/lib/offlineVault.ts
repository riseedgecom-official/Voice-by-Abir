import { AudioClipRecord, VoiceProfile } from "../types/studio";

const DB_NAME = "voice-by-abir-vault";
const DB_VERSION = 1;
const CLIPS_STORE = "clips";
const PROFILES_STORE = "profiles";

export interface OfflineClipEntry extends AudioClipRecord {
  audioBlob?: Blob;
}

function openVaultDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CLIPS_STORE)) {
        db.createObjectStore(CLIPS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PROFILES_STORE)) {
        db.createObjectStore(PROFILES_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open offline vault."));
  });
}

export async function saveClipToVault(
  meta: AudioClipRecord,
  audioBlob?: Blob
): Promise<void> {
  const db = await openVaultDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CLIPS_STORE, "readwrite");
    const store = tx.objectStore(CLIPS_STORE);
    const entry: OfflineClipEntry = {
      ...meta,
      cachedOffline: Boolean(audioBlob) || meta.cachedOffline,
      ...(audioBlob ? { audioBlob } : {}),
    };
    store.put(entry);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save clip offline."));
    };
  });
}

export async function getAllVaultClips(): Promise<AudioClipRecord[]> {
  const db = await openVaultDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CLIPS_STORE, "readonly");
    const store = tx.objectStore(CLIPS_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      const rows = (req.result as OfflineClipEntry[]) || [];
      const summaries: AudioClipRecord[] = rows
        .map(({ audioBlob, ...rest }) => ({
          ...rest,
          cachedOffline: Boolean(audioBlob),
        }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      resolve(summaries);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error("Failed to read offline clips."));
    };
  });
}

export async function getOfflineClipBlob(clipId: string): Promise<Blob | null> {
  const db = await openVaultDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CLIPS_STORE, "readonly");
    const store = tx.objectStore(CLIPS_STORE);
    const req = store.get(clipId);
    req.onsuccess = () => {
      db.close();
      const entry = req.result as OfflineClipEntry | undefined;
      resolve(entry?.audioBlob ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error("Failed to load offline audio blob."));
    };
  });
}

export async function removeOfflineBlobKeepCloudRecord(clipId: string): Promise<void> {
  const db = await openVaultDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CLIPS_STORE, "readwrite");
    const store = tx.objectStore(CLIPS_STORE);
    const getReq = store.get(clipId);
    getReq.onsuccess = () => {
      const entry = getReq.result as OfflineClipEntry | undefined;
      if (entry) {
        if (entry.driveFileId) {
          const { audioBlob: _removed, ...rest } = entry;
          store.put({ ...rest, cachedOffline: false });
        } else {
          store.delete(clipId);
        }
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to clear offline cache."));
    };
  });
}

export async function deleteVaultClip(clipId: string): Promise<void> {
  const db = await openVaultDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CLIPS_STORE, "readwrite");
    tx.objectStore(CLIPS_STORE).delete(clipId);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to delete clip from vault."));
    };
  });
}

export async function savePersonalVoicesLocal(profiles: VoiceProfile[]): Promise<void> {
  const db = await openVaultDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILES_STORE, "readwrite");
    const store = tx.objectStore(PROFILES_STORE);
    store.clear();
    for (const profile of profiles) {
      store.put(profile);
    }
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("Failed to save voice profiles locally."));
    };
  });
}

export async function loadPersonalVoicesLocal(): Promise<VoiceProfile[]> {
  const db = await openVaultDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROFILES_STORE, "readonly");
    const req = tx.objectStore(PROFILES_STORE).getAll();
    req.onsuccess = () => {
      db.close();
      const rows = (req.result as VoiceProfile[]) || [];
      resolve(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error("Failed to load local voice profiles."));
    };
  });
}
