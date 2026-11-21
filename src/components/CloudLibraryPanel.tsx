import { useMemo, useState } from "react";
import {
  Cloud,
  CloudOff,
  CloudUpload,
  Download,
  HardDrive,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { AudioClipRecord } from "../types/studio";
import { formatBytes, formatDuration, triggerBlobDownload } from "../lib/audioUtils";
import { WaveformPlayer } from "./WaveformPlayer";
import { ConfirmDialog } from "./ConfirmDialog";

interface CloudLibraryPanelProps {
  clips: AudioClipRecord[];
  isOnline: boolean;
  isDriveConnected: boolean;
  isSyncingDrive: boolean;
  onRequestGoogleSignIn: () => void;
  onSyncFromDrive: () => Promise<void>;
  onLoadClipBlob: (clip: AudioClipRecord) => Promise<Blob>;
  onCacheClipOffline: (clip: AudioClipRecord) => Promise<void>;
  onRemoveOfflineCache: (clip: AudioClipRecord) => Promise<void>;
  onUploadLocalClipToDrive: (clip: AudioClipRecord) => Promise<void>;
  onDeleteClip: (clip: AudioClipRecord, deleteFromDrive: boolean) => Promise<void>;
}

type LibraryFilter = "all" | "offline" | "cloud";

export function CloudLibraryPanel({
  clips,
  isOnline,
  isDriveConnected,
  isSyncingDrive,
  onRequestGoogleSignIn,
  onSyncFromDrive,
  onLoadClipBlob,
  onCacheClipOffline,
  onRemoveOfflineCache,
  onUploadLocalClipToDrive,
  onDeleteClip,
}: CloudLibraryPanelProps) {
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [busyClipId, setBusyClipId] = useState<string | null>(null);
  const [activePlayback, setActivePlayback] = useState<{
    clip: AudioClipRecord;
    blob: Blob;
  } | null>(null);
  const [confirmDeleteClip, setConfirmDeleteClip] = useState<AudioClipRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const offlineClips = clips.filter((c) => c.cachedOffline);
  const totalOfflineBytes = offlineClips.reduce((acc, c) => acc + (c.sizeBytes || 0), 0);

  const filteredClips = useMemo(() => {
    return clips.filter((clip) => {
      if (filter === "offline" && !clip.cachedOffline) return false;
      if (filter === "cloud" && !clip.driveFileId) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          clip.title.toLowerCase().includes(q) ||
          clip.voiceName.toLowerCase().includes(q) ||
          clip.sourceDocName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [clips, filter, searchQuery]);

  const handlePlayClip = async (clip: AudioClipRecord) => {
    setErrorMsg(null);
    setBusyClipId(clip.id);
    try {
      const blob = await onLoadClipBlob(clip);
      setActivePlayback({ clip, blob });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not load audio clip.");
    } finally {
      setBusyClipId(null);
    }
  };

  const handleDownloadClip = async (clip: AudioClipRecord) => {
    setErrorMsg(null);
    setBusyClipId(clip.id);
    try {
      const blob = await onLoadClipBlob(clip);
      const name = `${clip.title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "audio-clip"}.wav`;
      triggerBlobDownload(blob, name);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not download audio clip.");
    } finally {
      setBusyClipId(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8 space-y-6">
      {/* Header & Real Connection Status */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Cloud Storage & Offline Vault
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Audio clips saved to Google Drive can be cached locally for instant offline playback anywhere.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            {isOnline ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-emerald-600" />
                <span className="font-medium text-slate-800">Network Online</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-amber-600" />
                <span className="font-medium text-amber-800">
                  Offline Mode · Local Playback Active
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {offlineClips.length} cached offline ({formatBytes(totalOfflineBytes)})
            </span>
          </div>

          {isDriveConnected ? (
            <button
              type="button"
              onClick={() => void onSyncFromDrive()}
              disabled={isSyncingDrive || !isOnline}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isSyncingDrive ? "animate-spin" : ""}`} />
              {isSyncingDrive ? "Syncing Drive..." : "Sync Google Drive"}
            </button>
          ) : (
            <button
              type="button"
              onClick={onRequestGoogleSignIn}
              disabled={!isOnline}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Cloud className="h-3.5 w-3.5" />
              Connect Google Drive
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {errorMsg}
        </div>
      )}

      {/* Active Playback Deck */}
      {activePlayback && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-500">
              Now Playing {activePlayback.clip.cachedOffline ? "from Offline Vault" : "from Google Drive"}
            </span>
            <button
              type="button"
              onClick={() => setActivePlayback(null)}
              className="text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              Close Player
            </button>
          </div>
          <WaveformPlayer
            audioBlob={activePlayback.blob}
            title={activePlayback.clip.title}
            subtitle={`${activePlayback.clip.voiceName} · ${activePlayback.clip.sourceDocName}`}
            initialDurationSec={activePlayback.clip.durationSec}
          />
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              filter === "all"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            All Clips ({clips.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("offline")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              filter === "offline"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Available Offline ({offlineClips.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("cloud")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              filter === "cloud"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            In Google Drive ({clips.filter((c) => Boolean(c.driveFileId)).length})
          </button>
        </div>

        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search clips, voices, or files..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Clips Table */}
      {filteredClips.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-14 text-center">
          <p className="font-display text-base font-semibold text-slate-900">
            No audio clips found
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {clips.length === 0
              ? "Generate speech in the Studio tab and save it to Google Drive or your Offline Vault."
              : "Try clearing your search or switching library filters."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3">Clip & Source Document</th>
                  <th className="px-4 py-3">Voice Profile</th>
                  <th className="px-4 py-3">Storage Status</th>
                  <th className="px-4 py-3 text-right">Duration</th>
                  <th className="px-4 py-3 text-right">Size</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredClips.map((clip) => {
                  const isBusy = busyClipId === clip.id;
                  const canPlayNow = clip.cachedOffline || (isOnline && isDriveConnected);

                  return (
                    <tr
                      key={clip.id}
                      className="transition-colors hover:bg-slate-50/70"
                    >
                      <td className="px-4 py-3.5 max-w-xs">
                        <p className="truncate font-semibold text-slate-900">
                          {clip.title}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {clip.sourceDocName} · {new Date(clip.createdAt).toLocaleDateString()}
                        </p>
                      </td>

                      <td className="px-4 py-3.5 text-xs text-slate-700 whitespace-nowrap">
                        {clip.voiceName}
                      </td>

                      <td className="px-4 py-3.5 text-xs whitespace-nowrap">
                        <div className="flex items-center gap-2 text-slate-600">
                          {clip.driveFileId ? (
                            <span className="inline-flex items-center gap-1 text-blue-700 font-medium">
                              <Cloud className="h-3.5 w-3.5" />
                              Google Drive
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-500">
                              <CloudOff className="h-3.5 w-3.5" />
                              Local only
                            </span>
                          )}
                          <span aria-hidden="true">·</span>
                          {clip.cachedOffline ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                              <HardDrive className="h-3.5 w-3.5" />
                              Offline ready
                            </span>
                          ) : (
                            <span className="text-slate-400">Cloud only</span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                        {formatDuration(clip.durationSec)}
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                        {formatBytes(clip.sizeBytes)}
                      </td>

                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handlePlayClip(clip)}
                            disabled={isBusy || !canPlayNow}
                            title={
                              canPlayNow
                                ? "Play audio clip"
                                : "Connect online to stream from Drive"
                            }
                            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap shrink-0"
                          >
                            <Play className="h-3 w-3" />
                            {isBusy ? "Loading..." : "Play"}
                          </button>

                          {!clip.cachedOffline && clip.driveFileId && (
                            <button
                              type="button"
                              onClick={() => onCacheClipOffline(clip)}
                              disabled={isBusy || !isOnline || !isDriveConnected}
                              title="Download to browser vault for offline playback"
                              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
                            >
                              Cache Offline
                            </button>
                          )}

                          {clip.cachedOffline && clip.driveFileId && (
                            <button
                              type="button"
                              onClick={() => onRemoveOfflineCache(clip)}
                              disabled={isBusy}
                              title="Remove local offline copy (keeps Google Drive file)"
                              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
                            >
                              Evict Cache
                            </button>
                          )}

                          {!clip.driveFileId && isDriveConnected && isOnline && (
                            <button
                              type="button"
                              onClick={() => onUploadLocalClipToDrive(clip)}
                              disabled={isBusy}
                              title="Upload local clip to Google Drive"
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0"
                            >
                              <CloudUpload className="h-3 w-3" />
                              Upload
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleDownloadClip(clip)}
                            disabled={isBusy || !canPlayNow}
                            title="Download WAV file"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => setConfirmDeleteClip(clip)}
                            disabled={isBusy}
                            title="Delete audio clip"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mandatory Confirmation Modal before deleting files in Google Drive / Offline Vault */}
      <ConfirmDialog
        open={Boolean(confirmDeleteClip)}
        title="Delete Audio Clip?"
        description={
          confirmDeleteClip?.driveFileId
            ? `Are you sure you want to permanently delete "${confirmDeleteClip.title}" from your Google Drive ("Voice by Abir Audio" folder) and your Offline Vault? This action cannot be undone.`
            : `Are you sure you want to remove "${confirmDeleteClip?.title}" from your Offline Vault? This action cannot be undone.`
        }
        confirmLabel="Delete Permanently"
        destructive
        busy={isDeleting}
        onCancel={() => setConfirmDeleteClip(null)}
        onConfirm={async () => {
          if (!confirmDeleteClip) return;
          setIsDeleting(true);
          try {
            await onDeleteClip(
              confirmDeleteClip,
              Boolean(confirmDeleteClip.driveFileId && isDriveConnected && isOnline)
            );
            if (activePlayback?.clip.id === confirmDeleteClip.id) {
              setActivePlayback(null);
            }
            setConfirmDeleteClip(null);
          } catch (err) {
            setErrorMsg(
              err instanceof Error ? err.message : "Failed to delete audio clip."
            );
            setConfirmDeleteClip(null);
          } finally {
            setIsDeleting(false);
          }
        }}
      />
    </div>
  );
}
