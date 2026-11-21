import { useCallback, useEffect, useMemo, useState } from "react";
import { User } from "firebase/auth";
import {
  ActiveTab,
  AudioClipRecord,
  BaseGeminiVoice,
  VoiceProfile,
} from "./types/studio";
import { DEFAULT_STUDIO_VOICES } from "./lib/defaultVoices";
import {
  clearAccessToken,
  getAccessToken,
  googleSignIn,
  initAuth,
  logout,
} from "./lib/firebaseAuth";
import {
  deleteVaultClip,
  getAllVaultClips,
  getOfflineClipBlob,
  loadPersonalVoicesLocal,
  removeOfflineBlobKeepCloudRecord,
  saveClipToVault,
  savePersonalVoicesLocal,
} from "./lib/offlineVault";
import {
  deleteDriveFile,
  downloadDriveClipBlob,
  ensureStudioFolder,
  listDriveAudioClips,
  loadPersonalVoicesFromDrive,
  syncPersonalVoicesToDrive,
  uploadAudioClipToDrive,
} from "./lib/driveStorage";
import { Header } from "./components/Header";
import { StudioWorkspace } from "./components/StudioWorkspace";
import { VoiceProfilesPanel } from "./components/VoiceProfilesPanel";
import { CloudLibraryPanel } from "./components/CloudLibraryPanel";

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("studio");
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  const [user, setUser] = useState<User | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [driveFolderId, setDriveFolderId] = useState<string | null>(null);
  const [isSyncingDrive, setIsSyncingDrive] = useState(false);

  const [personalVoices, setPersonalVoices] = useState<VoiceProfile[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(
    DEFAULT_STUDIO_VOICES[0].id
  );
  const [clips, setClips] = useState<AudioClipRecord[]>([]);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const allVoiceProfiles = useMemo(
    () => [...personalVoices, ...DEFAULT_STUDIO_VOICES],
    [personalVoices]
  );

  // Track real network connectivity for offline playback awareness
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Load offline vault clips & personal voices immediately on startup (works offline)
  const reloadLocalVault = useCallback(async () => {
    try {
      const [localClips, localVoices] = await Promise.all([
        getAllVaultClips(),
        loadPersonalVoicesLocal(),
      ]);
      setClips(localClips);
      setPersonalVoices(localVoices);
      if (localVoices.length > 0) {
        setSelectedVoiceId((current) =>
          current === DEFAULT_STUDIO_VOICES[0].id ? localVoices[0].id : current
        );
      }
    } catch (err) {
      console.error("Failed to load local offline vault:", err);
    }
  }, []);

  useEffect(() => {
    void reloadLocalVault();
  }, [reloadLocalVault]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = initAuth(
      undefined,
      (authUser, tokenAvailable) => {
        setUser(authUser);
        setHasToken(tokenAvailable);
        if (!tokenAvailable) {
          setDriveFolderId(null);
        }
      }
    );
    return () => unsub();
  }, []);

  const syncDriveWorkspace = useCallback(
    async (explicitToken?: string) => {
      const token = explicitToken || getAccessToken();
      if (!token || !navigator.onLine) return;

      setIsSyncingDrive(true);
      setGlobalError(null);
      try {
        const folderId = driveFolderId || (await ensureStudioFolder(token));
        setDriveFolderId(folderId);

        // 1. Sync audio clips between Google Drive and IndexedDB vault
        const [driveClips, localClips] = await Promise.all([
          listDriveAudioClips(token, folderId),
          getAllVaultClips(),
        ]);

        const localById = new Map<string, AudioClipRecord>();
        const localByDriveId = new Map<string, AudioClipRecord>();
        for (const lc of localClips) {
          localById.set(lc.id, lc);
          if (lc.driveFileId) localByDriveId.set(lc.driveFileId, lc);
        }

        const mergedClips: AudioClipRecord[] = [];
        const seenIds = new Set<string>();

        for (const dc of driveClips) {
          const matchingLocal =
            localByDriveId.get(dc.driveFileId || "") || localById.get(dc.id);
          const merged: AudioClipRecord = {
            ...dc,
            id: matchingLocal?.id || dc.id,
            cachedOffline: Boolean(matchingLocal?.cachedOffline),
          };
          mergedClips.push(merged);
          seenIds.add(merged.id);
          if (!matchingLocal) {
            await saveClipToVault(merged);
          }
        }

        for (const lc of localClips) {
          if (!seenIds.has(lc.id)) {
            mergedClips.push(lc);
          }
        }

        mergedClips.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setClips(mergedClips);

        // 2. Sync personal voice profiles with Google Drive
        const driveProfiles = await loadPersonalVoicesFromDrive(token, folderId);
        const localVoices = await loadPersonalVoicesLocal();

        if (driveProfiles && driveProfiles.length > 0) {
          const byId = new Map<string, VoiceProfile>();
          for (const p of driveProfiles) byId.set(p.id, p);
          for (const p of localVoices) {
            if (!byId.has(p.id)) byId.set(p.id, p);
          }
          const combined = Array.from(byId.values()).sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt)
          );
          setPersonalVoices(combined);
          await savePersonalVoicesLocal(combined);
          if (combined.length > localVoices.length || localVoices.length > driveProfiles.length) {
            await syncPersonalVoicesToDrive(token, folderId, combined);
          }
        } else if (localVoices.length > 0) {
          await syncPersonalVoicesToDrive(token, folderId, localVoices);
        }
      } catch (err) {
        if (err instanceof Error && err.message === "AUTH_EXPIRED") {
          clearAccessToken();
          setHasToken(false);
          setGlobalError("Your Google Drive session expired. Sign in again to sync cloud files.");
        } else {
          setGlobalError(
            err instanceof Error ? err.message : "Failed to sync with Google Drive."
          );
        }
      } finally {
        setIsSyncingDrive(false);
      }
    },
    [driveFolderId]
  );

  const handleGoogleSignIn = async () => {
    setGlobalError(null);
    setIsSigningIn(true);
    try {
      const { user: signedInUser, accessToken } = await googleSignIn();
      setUser(signedInUser);
      setHasToken(true);
      await syncDriveWorkspace(accessToken);
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : "Google Sign-In did not complete."
      );
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setHasToken(false);
    setDriveFolderId(null);
    await reloadLocalVault();
  };

  const getValidFolderAndToken = async (): Promise<{
    token: string;
    folderId: string;
  }> => {
    const token = getAccessToken();
    if (!token) {
      throw new Error("Please sign in with Google to access Google Drive.");
    }
    const folderId = driveFolderId || (await ensureStudioFolder(token));
    if (!driveFolderId) setDriveFolderId(folderId);
    return { token, folderId };
  };

  const handleSaveClipToCloudAndOffline = async (
    meta: Omit<AudioClipRecord, "cachedOffline" | "driveFileId" | "driveWebViewLink">,
    blob: Blob,
    uploadToDrive: boolean
  ) => {
    let finalClip: AudioClipRecord = {
      ...meta,
      cachedOffline: true,
    };

    if (uploadToDrive) {
      const { token, folderId } = await getValidFolderAndToken();
      const uploaded = await uploadAudioClipToDrive(token, folderId, finalClip, blob);
      finalClip = {
        ...finalClip,
        driveFileId: uploaded.fileId,
        driveWebViewLink: uploaded.webViewLink,
      };
    }

    await saveClipToVault(finalClip, blob);
    setClips((prev) => [finalClip, ...prev.filter((c) => c.id !== finalClip.id)]);
  };

  const handleAddPersonalVoice = async (profile: VoiceProfile) => {
    const updated = [profile, ...personalVoices];
    setPersonalVoices(updated);
    setSelectedVoiceId(profile.id);
    await savePersonalVoicesLocal(updated);

    const token = getAccessToken();
    if (token && isOnline) {
      const folderId = driveFolderId || (await ensureStudioFolder(token));
      setDriveFolderId(folderId);
      await syncPersonalVoicesToDrive(token, folderId, updated);
    }
  };

  const handleUpdateVoiceStyle = async (voiceId: string, stylePrompt: string) => {
    const updated = personalVoices.map((p) =>
      p.id === voiceId ? { ...p, stylePrompt } : p
    );
    if (updated.some((p) => p.id === voiceId)) {
      setPersonalVoices(updated);
      await savePersonalVoicesLocal(updated);
      const token = getAccessToken();
      if (token && isOnline) {
        const folderId = driveFolderId || (await ensureStudioFolder(token));
        setDriveFolderId(folderId);
        await syncPersonalVoicesToDrive(token, folderId, updated);
      }
    }
  };

  const handleUpdateVoiceBase = async (voiceId: string, baseVoice: BaseGeminiVoice) => {
    const updated = personalVoices.map((p) =>
      p.id === voiceId ? { ...p, baseVoice } : p
    );
    if (updated.some((p) => p.id === voiceId)) {
      setPersonalVoices(updated);
      await savePersonalVoicesLocal(updated);
      const token = getAccessToken();
      if (token && isOnline) {
        const folderId = driveFolderId || (await ensureStudioFolder(token));
        setDriveFolderId(folderId);
        await syncPersonalVoicesToDrive(token, folderId, updated);
      }
    }
  };

  const handleDeletePersonalVoice = async (voiceId: string) => {
    const updated = personalVoices.filter((p) => p.id !== voiceId);
    setPersonalVoices(updated);
    if (selectedVoiceId === voiceId) {
      setSelectedVoiceId(updated[0]?.id || DEFAULT_STUDIO_VOICES[0].id);
    }
    await savePersonalVoicesLocal(updated);
    const token = getAccessToken();
    if (token && isOnline) {
      const folderId = driveFolderId || (await ensureStudioFolder(token));
      setDriveFolderId(folderId);
      await syncPersonalVoicesToDrive(token, folderId, updated);
    }
  };

  const handleLoadClipBlob = async (clip: AudioClipRecord): Promise<Blob> => {
    const localBlob = await getOfflineClipBlob(clip.id);
    if (localBlob) return localBlob;

    if (!clip.driveFileId) {
      throw new Error("This audio clip is not cached offline.");
    }
    if (!isOnline) {
      throw new Error("You are offline and this cloud clip has not been cached offline yet.");
    }
    const token = getAccessToken();
    if (!token) {
      throw new Error("Sign in with Google to stream or download this clip from Drive.");
    }

    const blob = await downloadDriveClipBlob(token, clip.driveFileId);
    // Automatically cache offline once downloaded so future offline playback works
    const updatedClip: AudioClipRecord = { ...clip, cachedOffline: true };
    await saveClipToVault(updatedClip, blob);
    setClips((prev) => prev.map((c) => (c.id === clip.id ? updatedClip : c)));
    return blob;
  };

  const handleCacheClipOffline = async (clip: AudioClipRecord) => {
    await handleLoadClipBlob(clip);
  };

  const handleRemoveOfflineCache = async (clip: AudioClipRecord) => {
    await removeOfflineBlobKeepCloudRecord(clip.id);
    setClips((prev) =>
      prev.map((c) => (c.id === clip.id ? { ...c, cachedOffline: false } : c))
    );
  };

  const handleUploadLocalClipToDrive = async (clip: AudioClipRecord) => {
    const blob = await getOfflineClipBlob(clip.id);
    if (!blob) {
      throw new Error("Local audio file not found in offline vault.");
    }
    const { token, folderId } = await getValidFolderAndToken();
    const uploaded = await uploadAudioClipToDrive(token, folderId, clip, blob);
    const updated: AudioClipRecord = {
      ...clip,
      driveFileId: uploaded.fileId,
      driveWebViewLink: uploaded.webViewLink,
    };
    await saveClipToVault(updated, blob);
    setClips((prev) => prev.map((c) => (c.id === clip.id ? updated : c)));
  };

  const handleDeleteClip = async (
    clip: AudioClipRecord,
    deleteFromDrive: boolean
  ) => {
    if (deleteFromDrive && clip.driveFileId) {
      const token = getAccessToken();
      if (!token) {
        throw new Error("Sign in with Google to delete files from Google Drive.");
      }
      await deleteDriveFile(token, clip.driveFileId);
    }
    await deleteVaultClip(clip.id);
    setClips((prev) => prev.filter((c) => c.id !== clip.id));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        user={user}
        hasToken={hasToken}
        isSigningIn={isSigningIn}
        onSignIn={handleGoogleSignIn}
        onSignOut={handleSignOut}
      />

      {globalError && (
        <div className="mx-auto mt-4 w-full max-w-[1440px] px-6">
          <div
            role="alert"
            className="flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-900"
          >
            <span>{globalError}</span>
            <button
              type="button"
              onClick={() => setGlobalError(null)}
              className="underline hover:text-amber-950 shrink-0"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <main className="flex-1">
        {activeTab === "studio" && (
          <StudioWorkspace
            voiceProfiles={allVoiceProfiles}
            selectedVoiceId={selectedVoiceId}
            onSelectVoiceId={setSelectedVoiceId}
            onNavigateTab={setActiveTab}
            onAddPersonalVoice={handleAddPersonalVoice}
            onUpdateVoiceBase={handleUpdateVoiceBase}
            isOnline={isOnline}
            isDriveConnected={Boolean(user && hasToken)}
            onRequestGoogleSignIn={handleGoogleSignIn}
            onSaveClipToCloudAndOffline={handleSaveClipToCloudAndOffline}
          />
        )}

        {activeTab === "voices" && (
          <VoiceProfilesPanel
            profiles={allVoiceProfiles}
            selectedVoiceId={selectedVoiceId}
            isOnline={isOnline}
            onSelectVoiceForStudio={(id) => {
              setSelectedVoiceId(id);
              setActiveTab("studio");
            }}
            onAddPersonalVoice={handleAddPersonalVoice}
            onUpdateVoiceStyle={handleUpdateVoiceStyle}
            onUpdateVoiceBase={handleUpdateVoiceBase}
            onDeletePersonalVoice={handleDeletePersonalVoice}
          />
        )}

        {activeTab === "library" && (
          <CloudLibraryPanel
            clips={clips}
            isOnline={isOnline}
            isDriveConnected={Boolean(user && hasToken)}
            isSyncingDrive={isSyncingDrive}
            onRequestGoogleSignIn={handleGoogleSignIn}
            onSyncFromDrive={() => syncDriveWorkspace()}
            onLoadClipBlob={handleLoadClipBlob}
            onCacheClipOffline={handleCacheClipOffline}
            onRemoveOfflineCache={handleRemoveOfflineCache}
            onUploadLocalClipToDrive={handleUploadLocalClipToDrive}
            onDeleteClip={handleDeleteClip}
          />
        )}
      </main>
    </div>
  );
}
