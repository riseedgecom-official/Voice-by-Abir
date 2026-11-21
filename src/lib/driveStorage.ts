import { AudioClipRecord, VoiceProfile } from "../types/studio";

const STUDIO_FOLDER_NAME = "Voice by Abir Audio";
const PROFILES_FILE_NAME = "voice-profiles.json";

interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
}

async function driveFetch(
  url: string,
  token: string,
  init: RequestInit = {}
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });

  if (res.status === 401) {
    throw new Error("AUTH_EXPIRED");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Drive error (${res.status}): ${text || res.statusText}`);
  }
  return res;
}

export async function ensureStudioFolder(token: string): Promise<string> {
  const query = encodeURIComponent(
    `name='${STUDIO_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&spaces=drive`,
    token
  );
  const data = (await res.json()) as { files?: DriveFileItem[] };
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }

  const createRes = await driveFetch("https://www.googleapis.com/drive/v3/files", token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: STUDIO_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

export async function uploadAudioClipToDrive(
  token: string,
  folderId: string,
  clip: AudioClipRecord,
  wavBlob: Blob
): Promise<{ fileId: string; webViewLink?: string }> {
  const safeName = `${clip.title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "audio-clip"}.wav`;
  const metadata = {
    name: safeName,
    mimeType: "audio/wav",
    parents: [folderId],
    appProperties: {
      clipId: clip.id,
      title: clip.title.slice(0, 100),
      voiceId: clip.voiceId,
      voiceName: clip.voiceName.slice(0, 80),
      sourceDocName: clip.sourceDocName.slice(0, 80),
      prosodySummary: clip.prosodySummary.slice(0, 110),
      durationSec: String(clip.durationSec),
      beatsCount: String(clip.beatsCount),
      createdAt: clip.createdAt,
      scriptPreview: clip.scriptPreview.slice(0, 110),
    },
  };

  const formData = new FormData();
  formData.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" })
  );
  formData.append("file", wavBlob, safeName);

  const res = await driveFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,size",
    token,
    {
      method: "POST",
      body: formData,
    }
  );
  const uploaded = (await res.json()) as DriveFileItem;
  return { fileId: uploaded.id, webViewLink: uploaded.webViewLink };
}

export async function listDriveAudioClips(
  token: string,
  folderId: string
): Promise<AudioClipRecord[]> {
  const query = encodeURIComponent(
    `'${folderId}' in parents and mimeType='audio/wav' and trashed=false`
  );
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=createdTime desc&fields=files(id,name,size,createdTime,webViewLink,appProperties)`,
    token
  );
  const data = (await res.json()) as { files?: DriveFileItem[] };
  const files = data.files ?? [];

  return files.map((file) => {
    const props = file.appProperties ?? {};
    return {
      id: props.clipId || `drive-${file.id}`,
      title: props.title || file.name.replace(/\.wav$/i, ""),
      voiceId: props.voiceId || "preset-kore-narrator",
      voiceName: props.voiceName || "Studio Voice",
      sourceDocName: props.sourceDocName || "Cloud Audio",
      prosodySummary: props.prosodySummary || "Expressive AI-directed speech",
      durationSec: Number(props.durationSec) || 0,
      sizeBytes: Number(file.size) || 0,
      createdAt: props.createdAt || file.createdTime || new Date().toISOString(),
      driveFileId: file.id,
      driveWebViewLink: file.webViewLink,
      cachedOffline: false,
      beatsCount: Number(props.beatsCount) || 1,
      scriptPreview: props.scriptPreview || "",
    };
  });
}

export async function downloadDriveClipBlob(token: string, fileId: string): Promise<Blob> {
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    token
  );
  return await res.blob();
}

export async function deleteDriveFile(token: string, fileId: string): Promise<void> {
  await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    token,
    { method: "DELETE" }
  );
}

export async function loadPersonalVoicesFromDrive(
  token: string,
  folderId: string
): Promise<VoiceProfile[] | null> {
  const query = encodeURIComponent(
    `name='${PROFILES_FILE_NAME}' and '${folderId}' in parents and trashed=false`
  );
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`,
    token
  );
  const data = (await res.json()) as { files?: DriveFileItem[] };
  const file = data.files?.[0];
  if (!file) return null;

  const contentRes = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
    token
  );
  const parsed = (await contentRes.json()) as VoiceProfile[];
  return Array.isArray(parsed) ? parsed : [];
}

export async function syncPersonalVoicesToDrive(
  token: string,
  folderId: string,
  profiles: VoiceProfile[]
): Promise<void> {
  const query = encodeURIComponent(
    `name='${PROFILES_FILE_NAME}' and '${folderId}' in parents and trashed=false`
  );
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`,
    token
  );
  const data = (await res.json()) as { files?: DriveFileItem[] };
  const existing = data.files?.[0];
  const jsonBlob = new Blob([JSON.stringify(profiles, null, 2)], {
    type: "application/json",
  });

  if (existing) {
    await driveFetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: jsonBlob,
      }
    );
  } else {
    const formData = new FormData();
    formData.append(
      "metadata",
      new Blob(
        [
          JSON.stringify({
            name: PROFILES_FILE_NAME,
            mimeType: "application/json",
            parents: [folderId],
          }),
        ],
        { type: "application/json" }
      )
    );
    formData.append("file", jsonBlob, PROFILES_FILE_NAME);
    await driveFetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      token,
      {
        method: "POST",
        body: formData,
      }
    );
  }
}
