import { useEffect, useRef, useState } from "react";
import {
  AudioWaveform,
  CloudUpload,
  FileText,
  HardDriveDownload,
  Mic,
  Play,
  Plus,
  Sparkles,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import {
  ActiveTab,
  AudioClipRecord,
  BaseGeminiVoice,
  ProsodyBeat,
  SynthesisMode,
  VoiceProfile,
} from "../types/studio";
import { SAMPLE_DOCUMENTS } from "../lib/defaultVoices";
import { base64ToBlob, formatBytes, formatDuration } from "../lib/audioUtils";
import { WaveformPlayer } from "./WaveformPlayer";

interface StudioWorkspaceProps {
  voiceProfiles: VoiceProfile[];
  selectedVoiceId: string;
  onSelectVoiceId: (id: string) => void;
  onNavigateTab: (tab: ActiveTab) => void;
  onAddPersonalVoice: (profile: VoiceProfile) => Promise<void>;
  onUpdateVoiceBase: (voiceId: string, baseVoice: BaseGeminiVoice) => Promise<void>;
  isOnline: boolean;
  isDriveConnected: boolean;
  onRequestGoogleSignIn: () => void;
  onSaveClipToCloudAndOffline: (
    meta: Omit<AudioClipRecord, "cachedOffline" | "driveFileId" | "driveWebViewLink">,
    blob: Blob,
    uploadToDrive: boolean
  ) => Promise<void>;
}

const EXPRESSION_CUES = [
  { label: "Warm & reassuring", insert: "[warm and reassuring] " },
  { label: "Pause 800ms", insert: "[pause 800ms] " },
  { label: "Excited emphasis", insert: "[excited emphasis] " },
  { label: "Soft whisper", insert: "[soft whisper] " },
  { label: "Natural breath", insert: "<breath> " },
];

export function StudioWorkspace({
  voiceProfiles,
  selectedVoiceId,
  onSelectVoiceId,
  onNavigateTab,
  onAddPersonalVoice,
  onUpdateVoiceBase,
  isOnline,
  isDriveConnected,
  onRequestGoogleSignIn,
  onSaveClipToCloudAndOffline,
}: StudioWorkspaceProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const voiceSampleInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const quickRecorderRef = useRef<MediaRecorder | null>(null);
  const quickStreamRef = useRef<MediaStream | null>(null);
  const quickChunksRef = useRef<Blob[]>([]);
  const quickTimerRef = useRef<number | null>(null);

  const [sourceDocName, setSourceDocName] = useState("product-reveal-keynote.txt");
  const [clipTitle, setClipTitle] = useState("Product Reveal Keynote");
  const [rawText, setRawText] = useState(SAMPLE_DOCUMENTS[0].text);
  const [prosodyInstructions, setProsodyInstructions] = useState(
    SAMPLE_DOCUMENTS[0].prosodyInstructions
  );
  const [prosodySummary, setProsodySummary] = useState("");
  const [beats, setBeats] = useState<ProsodyBeat[]>([]);
  const [editorMode, setEditorMode] = useState<"source" | "beats">("source");
  const [synthesisMode, setSynthesisMode] = useState<SynthesisMode>("expressive");

  const [isDragging, setIsDragging] = useState(false);
  const [isExtractingDoc, setIsExtractingDoc] = useState(false);
  const [isExtractingVoiceDna, setIsExtractingVoiceDna] = useState(false);
  const [isQuickRecording, setIsQuickRecording] = useState(false);
  const [quickRecordSec, setQuickRecordSec] = useState(0);
  const [voiceDnaNotice, setVoiceDnaNotice] = useState<string | null>(null);
  const [isDirectingProsody, setIsDirectingProsody] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [previewingBeatId, setPreviewingBeatId] = useState<string | null>(null);
  const [isSavingClip, setIsSavingClip] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [generatedAudio, setGeneratedAudio] = useState<{
    blob: Blob;
    durationSec: number;
    sizeBytes: number;
    beatCount: number;
    title: string;
    voiceName: string;
  } | null>(null);

  const activeVoice =
    voiceProfiles.find((v) => v.id === selectedVoiceId) || voiceProfiles[0];

  const wordCount = rawText.trim() ? rawText.trim().split(/\s+/).length : 0;

  useEffect(() => {
    return () => {
      if (quickTimerRef.current) window.clearInterval(quickTimerRef.current);
      quickStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const extractVoiceDnaFromBlob = async (blob: Blob, defaultName: string, durationSec?: number) => {
    setErrorMsg(null);
    setVoiceDnaNotice(null);
    setIsExtractingVoiceDna(true);
    try {
      const formData = new FormData();
      const ext = blob.type.includes("wav")
        ? "wav"
        : blob.type.includes("mp3")
        ? "mp3"
        : "webm";
      formData.append("audio", blob, `sample-voice.${ext}`);
      formData.append("profileName", defaultName);

      const res = await fetch("/api/voice/calibrate", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not extract Voice DNA from sample.");
      }

      const newProfile: VoiceProfile = {
        id: `voice-${Date.now()}`,
        name: data.profileName,
        isPersonal: true,
        baseVoice: data.matchedBaseVoice,
        stylePrompt: data.stylePrompt,
        pitchLabel: data.pitchLabel,
        paceLabel: data.paceLabel,
        timbreLabel: data.timbreLabel,
        calibrationSummary: data.calibrationSummary,
        createdAt: new Date().toISOString(),
        sampleDurationSec: durationSec,
        voiceDna: data.voiceDna,
      };

      await onAddPersonalVoice(newProfile);
      setVoiceDnaNotice(
        `Copied Voice DNA into "${newProfile.name}" (matched to ${newProfile.baseVoice} foundation). Ready to generate.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Voice DNA extraction failed.");
    } finally {
      setIsExtractingVoiceDna(false);
    }
  };

  const handleToggleQuickRecord = async () => {
    if (isQuickRecording) {
      if (quickTimerRef.current) {
        window.clearInterval(quickTimerRef.current);
        quickTimerRef.current = null;
      }
      if (quickRecorderRef.current && quickRecorderRef.current.state !== "inactive") {
        quickRecorderRef.current.stop();
      }
      setIsQuickRecording(false);
      return;
    }

    setErrorMsg(null);
    setVoiceDnaNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      quickStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      quickChunksRef.current = [];
      let recordedSeconds = 0;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) quickChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(quickChunksRef.current, { type: mimeType });
        const label = `Sampled Voice (${new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })})`;
        void extractVoiceDnaFromBlob(blob, label, recordedSeconds);
      };

      quickRecorderRef.current = recorder;
      recorder.start();
      setIsQuickRecording(true);
      setQuickRecordSec(0);
      quickTimerRef.current = window.setInterval(() => {
        recordedSeconds += 1;
        setQuickRecordSec(recordedSeconds);
      }, 1000);
    } catch {
      setErrorMsg("Microphone unavailable. Upload a sample audio file instead.");
    }
  };

  const handleDocumentUpload = async (file: File) => {
    setErrorMsg(null);
    setSaveFeedback(null);
    setIsExtractingDoc(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/documents/extract", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to extract text from document.");
      }
      setRawText(data.text);
      setSourceDocName(data.fileName);
      const baseTitle = data.fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
      setClipTitle(baseTitle.charAt(0).toUpperCase() + baseTitle.slice(1));
      setBeats([]);
      setEditorMode("source");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not read document.");
    } finally {
      setIsExtractingDoc(false);
    }
  };

  const handleLoadSample = (sampleId: string) => {
    const sample = SAMPLE_DOCUMENTS.find((s) => s.id === sampleId);
    if (!sample) return;
    setRawText(sample.text);
    setProsodyInstructions(sample.prosodyInstructions);
    setSourceDocName(sample.fileName);
    setClipTitle(sample.title);
    setBeats([]);
    setProsodySummary("");
    setEditorMode("source");
    setErrorMsg(null);
  };

  const insertCueAtCursor = (cue: string) => {
    const el = textareaRef.current;
    if (!el) {
      setRawText((prev) => `${prev}${prev.endsWith(" ") || !prev ? "" : " "}${cue}`);
      return;
    }
    const start = el.selectionStart ?? rawText.length;
    const end = el.selectionEnd ?? rawText.length;
    const next = rawText.slice(0, start) + cue + rawText.slice(end);
    setRawText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + cue.length, start + cue.length);
    });
  };

  const runProsodyDirection = async (): Promise<ProsodyBeat[]> => {
    const res = await fetch("/api/prosody/direct", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawText,
        prosodyInstructions,
        voiceName: activeVoice?.name,
        voiceStylePrompt: activeVoice?.stylePrompt,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to analyze prosody.");
    }
    setBeats(data.beats);
    setProsodySummary(data.summary || "");
    setEditorMode("beats");
    return data.beats as ProsodyBeat[];
  };

  const handleAnalyzeProsody = async () => {
    if (!rawText.trim()) {
      setErrorMsg("Upload a document or enter script text first.");
      return;
    }
    setErrorMsg(null);
    setIsDirectingProsody(true);
    try {
      await runProsodyDirection();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Prosody analysis failed.");
    } finally {
      setIsDirectingProsody(false);
    }
  };

  const handleGenerateSpeech = async () => {
    if (!rawText.trim() && beats.length === 0) {
      setErrorMsg("Please upload a document or write a script before generating speech.");
      return;
    }
    if (!activeVoice) {
      setErrorMsg("Please select a voice profile.");
      return;
    }

    setErrorMsg(null);
    setSaveFeedback(null);
    setIsSynthesizing(true);

    try {
      let targetBeats = beats;
      if (targetBeats.length === 0) {
        if (prosodyInstructions.trim() || /\[[^\]]+\]/.test(rawText)) {
          targetBeats = await runProsodyDirection();
        } else {
          targetBeats = [
            {
              id: `beat-${Date.now()}`,
              text: rawText.trim(),
              expressionLabel: "Natural delivery",
              styleDirective:
                "Warm, natural human pacing with expressive intonation and subtle pauses.",
              pauseAfterMs: 0,
            },
          ];
          setBeats(targetBeats);
        }
      }

      const res = await fetch("/api/tts/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beats: targetBeats,
          baseVoice: activeVoice.baseVoice,
          voiceStylePrompt: activeVoice.stylePrompt,
          modelMode: synthesisMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Speech synthesis failed.");
      }

      const blob = base64ToBlob(data.audioBase64, data.mimeType || "audio/wav");
      setGeneratedAudio({
        blob,
        durationSec: data.durationSec,
        sizeBytes: data.sizeBytes,
        beatCount: data.beatCount || targetBeats.length,
        title: clipTitle.trim() || "Untitled Audio Clip",
        voiceName: activeVoice.name,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to synthesize speech.");
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handlePreviewSingleBeat = async (beat: ProsodyBeat) => {
    if (!activeVoice || !beat.text.trim()) return;
    setErrorMsg(null);
    setPreviewingBeatId(beat.id);
    try {
      const res = await fetch("/api/tts/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beats: [{ ...beat, pauseAfterMs: 0 }],
          baseVoice: activeVoice.baseVoice,
          voiceStylePrompt: activeVoice.stylePrompt,
          modelMode: synthesisMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Beat preview failed.");
      }
      const blob = base64ToBlob(data.audioBase64, "audio/wav");
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not preview beat.");
    } finally {
      setPreviewingBeatId(null);
    }
  };

  const handleSave = async (uploadToDrive: boolean) => {
    if (!generatedAudio) return;
    setErrorMsg(null);
    setSaveFeedback(null);
    setIsSavingClip(true);
    try {
      const meta: Omit<
        AudioClipRecord,
        "cachedOffline" | "driveFileId" | "driveWebViewLink"
      > = {
        id: `clip-${Date.now()}`,
        title: clipTitle.trim() || generatedAudio.title,
        voiceId: activeVoice.id,
        voiceName: activeVoice.name,
        sourceDocName,
        prosodySummary:
          prosodySummary ||
          prosodyInstructions.slice(0, 100) ||
          "Natural human prosody",
        durationSec: generatedAudio.durationSec,
        sizeBytes: generatedAudio.sizeBytes,
        createdAt: new Date().toISOString(),
        beatsCount: generatedAudio.beatCount,
        scriptPreview: rawText.trim().slice(0, 100),
      };

      await onSaveClipToCloudAndOffline(meta, generatedAudio.blob, uploadToDrive);
      setSaveFeedback(
        uploadToDrive
          ? "Saved to Google Drive and cached in your Offline Vault."
          : "Saved to your Offline Vault for playback anytime."
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save audio clip.");
    } finally {
      setIsSavingClip(false);
    }
  };

  const updateBeat = (id: string, patch: Partial<ProsodyBeat>) => {
    setBeats((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const removeBeat = (id: string) => {
    setBeats((prev) => prev.filter((b) => b.id !== id));
  };

  const addBeat = () => {
    setBeats((prev) => [
      ...prev,
      {
        id: `beat-${Date.now()}`,
        text: "",
        expressionLabel: "New beat",
        styleDirective: "Natural, warm conversational delivery",
        pauseAfterMs: 400,
      },
    ]);
  };

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Document-to-Speech Prosody Studio
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Upload a document, describe where and how expressions occur, and synthesize speech using your voice profile.
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="tabular-nums">{wordCount} words</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{beats.length} prosody beats</span>
          <span aria-hidden="true">·</span>
          <span className={isOnline ? "text-emerald-700 font-medium" : "text-amber-700 font-medium"}>
            {isOnline ? "Online" : "Offline mode"}
          </span>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-xs font-medium text-red-700 underline hover:text-red-900 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
        {/* Left Column: Document Upload + Natural-Language Prosody Direction */}
        <div className="lg:col-span-7 space-y-6">
          {/* Document Upload Dropzone & Quick Presets */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void handleDocumentUpload(file);
            }}
            className={`rounded-xl border transition-colors p-5 ${
              isDragging
                ? "border-blue-500 bg-blue-50/50"
                : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {sourceDocName}
                  </p>
                  <p className="text-xs text-slate-500">
                    Supports TXT, Markdown, DOCX, PDF, and CSV up to 20 MB
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.csv,.json,.docx,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleDocumentUpload(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isExtractingDoc}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {isExtractingDoc ? "Extracting text..." : "Upload Document"}
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
              <span>Load sample:</span>
              {SAMPLE_DOCUMENTS.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => handleLoadSample(sample.id)}
                  className="font-medium text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-blue-600 hover:decoration-blue-600 transition-colors whitespace-nowrap shrink-0"
                >
                  {sample.title}
                </button>
              ))}
            </div>
          </div>

          {/* Script & Directed Beats Workspace */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setEditorMode("source")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    editorMode === "source"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Source Script
                </button>
                <button
                  type="button"
                  onClick={() => setEditorMode("beats")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                    editorMode === "beats"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Directed Beats ({beats.length})
                </button>
              </div>

              <button
                type="button"
                onClick={handleAnalyzeProsody}
                disabled={isDirectingProsody || !rawText.trim() || !isOnline}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {isDirectingProsody ? "Directing Prosody..." : "Apply AI Prosody"}
              </button>
            </div>

            {editorMode === "source" ? (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <label
                      htmlFor="script-textarea"
                      className="text-xs font-semibold text-slate-700"
                    >
                      Document Text (optional inline cues like [pause 800ms] or [whisper])
                    </label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {EXPRESSION_CUES.map((cue) => (
                        <button
                          key={cue.label}
                          type="button"
                          onClick={() => insertCueAtCursor(cue.insert)}
                          className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0"
                        >
                          + {cue.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    id="script-textarea"
                    ref={textareaRef}
                    value={rawText}
                    onChange={(e) => {
                      setRawText(e.target.value);
                      if (beats.length > 0) setBeats([]);
                    }}
                    rows={9}
                    placeholder="Paste your script or upload a document above..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50/40 p-3.5 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/15"
                  />
                </div>

                <div>
                  <label
                    htmlFor="prosody-instructions"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Natural-Language Expression Directions
                  </label>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Describe in plain English where pauses, shifts in emotion, emphasis, or vocal warmth occur.
                  </p>
                  <textarea
                    id="prosody-instructions"
                    value={prosodyInstructions}
                    onChange={(e) => {
                      setProsodyInstructions(e.target.value);
                      if (beats.length > 0) setBeats([]);
                    }}
                    rows={3}
                    placeholder="e.g., Start calm and conversational, pause briefly before the reveal, sound genuinely excited on the key takeaway, and soften into a reflective close."
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50/40 p-3 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/15"
                  />
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {prosodySummary && (
                  <p className="text-xs leading-relaxed text-slate-600 border-b border-slate-100 pb-3">
                    <span className="font-semibold text-slate-800">Directed Arc: </span>
                    {prosodySummary}
                  </p>
                )}

                {beats.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-sm font-medium text-slate-700">
                      No prosody beats directed yet.
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Click "Apply AI Prosody" above to break your script into expressive human beats.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {beats.map((beat, idx) => (
                      <div
                        key={beat.id}
                        className="rounded-lg border border-slate-200 bg-slate-50/50 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <span className="font-mono text-xs font-semibold text-slate-400 tabular-nums">
                              {String(idx + 1).padStart(2, "0")}
                            </span>
                            <input
                              type="text"
                              value={beat.expressionLabel}
                              onChange={(e) =>
                                updateBeat(beat.id, { expressionLabel: e.target.value })
                              }
                              aria-label="Expression label"
                              className="w-full max-w-[220px] rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs font-semibold text-slate-900 hover:border-slate-200 focus:border-blue-500 focus:bg-white focus:outline-none"
                            />
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <label className="flex items-center gap-1.5 text-xs text-slate-500">
                              <span>Pause</span>
                              <select
                                value={beat.pauseAfterMs}
                                onChange={(e) =>
                                  updateBeat(beat.id, {
                                    pauseAfterMs: Number(e.target.value),
                                  })
                                }
                                className="rounded border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-700 tabular-nums focus:border-blue-500 focus:outline-none"
                              >
                                <option value={0}>0ms</option>
                                <option value={300}>300ms</option>
                                <option value={600}>600ms</option>
                                <option value={1000}>1000ms</option>
                                <option value={1500}>1500ms</option>
                                <option value={2200}>2200ms</option>
                              </select>
                            </label>

                            <button
                              type="button"
                              onClick={() => handlePreviewSingleBeat(beat)}
                              disabled={previewingBeatId === beat.id || !isOnline}
                              title="Preview this beat"
                              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                            >
                              <Play className="h-3 w-3" />
                              {previewingBeatId === beat.id ? "Playing..." : "Preview"}
                            </button>

                            <button
                              type="button"
                              onClick={() => removeBeat(beat.id)}
                              title="Remove beat"
                              className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        <textarea
                          value={beat.text}
                          onChange={(e) => updateBeat(beat.id, { text: e.target.value })}
                          rows={2}
                          aria-label="Spoken text"
                          className="mt-2.5 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-900 focus:border-blue-500 focus:outline-none"
                        />

                        <div className="mt-2">
                          <input
                            type="text"
                            value={beat.styleDirective}
                            onChange={(e) =>
                              updateBeat(beat.id, { styleDirective: e.target.value })
                            }
                            aria-label="Expression style directive"
                            placeholder="Describe tone, pace, and vocal emotion for this beat..."
                            className="w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 focus:border-blue-500 focus:text-slate-900 focus:outline-none"
                          />
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={addBeat}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Beat
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Voice Profile Selection, Synthesis & Cloud/Offline Saving */}
        <div className="lg:col-span-5 space-y-6">
          {/* Active Voice Profile & Sample Voice DNA Cloning */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Voice DNA & Profile
              </h2>
              <button
                type="button"
                onClick={() => onNavigateTab("voices")}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
              >
                Manage All Profiles
              </button>
            </div>

            {/* Instant Sample Voice DNA Extractor right inside Studio */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-800">
                  Copy Voice DNA from Sample Audio
                </p>
                {isQuickRecording && (
                  <span className="font-mono text-xs font-semibold text-red-600 tabular-nums">
                    {formatDuration(quickRecordSec)}
                  </span>
                )}
              </div>
              <p className="text-[11px] leading-relaxed text-slate-500">
                Upload or record any reference voice sample and AI will copy its pitch, cadence, accent, and vocal DNA for your script.
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <input
                  ref={voiceSampleInputRef}
                  type="file"
                  accept="audio/*,.wav,.mp3,.webm,.m4a,.ogg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const cleanName =
                        file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") ||
                        "Sampled Voice DNA";
                      void extractVoiceDnaFromBlob(file, cleanName);
                    }
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => voiceSampleInputRef.current?.click()}
                  disabled={isExtractingVoiceDna || isQuickRecording || !isOnline}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {isExtractingVoiceDna ? "Copying Voice DNA..." : "Upload Sample Voice"}
                </button>

                <button
                  type="button"
                  onClick={() => void handleToggleQuickRecord()}
                  disabled={isExtractingVoiceDna || !isOnline}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 ${
                    isQuickRecording
                      ? "bg-red-600 text-white hover:bg-red-700"
                      : "bg-slate-900 text-white hover:bg-slate-800"
                  }`}
                >
                  {isQuickRecording ? (
                    <>
                      <Square className="h-3 w-3" />
                      Stop & Copy DNA
                    </>
                  ) : (
                    <>
                      <Mic className="h-3.5 w-3.5" />
                      Record Sample
                    </>
                  )}
                </button>
              </div>

              {voiceDnaNotice && (
                <p className="text-[11px] font-medium text-emerald-700">
                  {voiceDnaNotice}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="voice-select" className="sr-only">
                Select Voice Profile
              </label>
              <select
                id="voice-select"
                value={activeVoice?.id || ""}
                onChange={(e) => onSelectVoiceId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15"
              >
                {voiceProfiles.some((v) => v.isPersonal) && (
                  <optgroup label="Copied Sample & Personal Voices">
                    {voiceProfiles
                      .filter((v) => v.isPersonal)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} (Voice DNA · {v.baseVoice})
                        </option>
                      ))}
                  </optgroup>
                )}
                <optgroup label="Studio Preset Voices">
                  {voiceProfiles
                    .filter((v) => !v.isPersonal)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.baseVoice})
                      </option>
                    ))}
                </optgroup>
              </select>
            </div>

            {activeVoice && (
              <div className="border-t border-slate-100 pt-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-700">
                      {activeVoice.isPersonal ? "Copied Voice DNA" : "Studio Preset"}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{activeVoice.pitchLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span>{activeVoice.paceLabel}</span>
                  </div>

                  {activeVoice.isPersonal && (
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                      <span>Base:</span>
                      <select
                        value={activeVoice.baseVoice}
                        onChange={(e) =>
                          void onUpdateVoiceBase(
                            activeVoice.id,
                            e.target.value as BaseGeminiVoice
                          )
                        }
                        className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
                      >
                        <option value="Kore">Kore</option>
                        <option value="Charon">Charon</option>
                        <option value="Fenrir">Fenrir</option>
                        <option value="Puck">Puck</option>
                        <option value="Zephyr">Zephyr</option>
                      </select>
                    </label>
                  )}
                </div>

                {activeVoice.voiceDna && (
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-100 bg-slate-50/70 p-2.5 text-[11px]">
                    <div>
                      <span className="block text-slate-400">Pitch & Range</span>
                      <span className="font-medium text-slate-800">{activeVoice.voiceDna.pitchHzEstimate}</span>
                    </div>
                    <div>
                      <span className="block text-slate-400">Cadence</span>
                      <span className="font-medium text-slate-800">{activeVoice.voiceDna.speakingWpm}</span>
                    </div>
                    <div>
                      <span className="block text-slate-400">Accent & Tone</span>
                      <span className="font-medium text-slate-800">{activeVoice.voiceDna.accentTone}</span>
                    </div>
                    <div>
                      <span className="block text-slate-400">Inflection</span>
                      <span className="font-medium text-slate-800">{activeVoice.voiceDna.inflectionPattern}</span>
                    </div>
                  </div>
                )}

                <p className="text-xs leading-relaxed text-slate-600">
                  {activeVoice.stylePrompt}
                </p>
              </div>
            )}
          </div>

          {/* Synthesis Controls */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <label
                htmlFor="clip-title-input"
                className="block text-xs font-semibold text-slate-700"
              >
                Clip Title
              </label>
              <input
                id="clip-title-input"
                type="text"
                value={clipTitle}
                onChange={(e) => setClipTitle(e.target.value)}
                placeholder="Enter a name for this audio clip"
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15"
              />
            </div>

            <div>
              <span className="block text-xs font-semibold text-slate-700">
                Synthesis Engine
              </span>
              <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setSynthesisMode("expressive")}
                  className={`rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    synthesisMode === "expressive"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Expressive Prosody
                </button>
                <button
                  type="button"
                  onClick={() => setSynthesisMode("fast")}
                  className={`rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    synthesisMode === "fast"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Fast Standard
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGenerateSpeech}
              disabled={isSynthesizing || !isOnline}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <AudioWaveform className="h-4 w-4" />
              {isSynthesizing
                ? "Synthesizing Expressive Audio..."
                : isOnline
                ? "Generate Speech"
                : "Reconnect to Generate New Speech"}
            </button>
          </div>

          {/* Live Output Player & Cloud/Offline Storage */}
          {generatedAudio && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display text-sm font-semibold text-slate-900">
                  Generated Audio
                </h2>
                <div className="flex items-center gap-2 font-mono text-xs text-slate-500 tabular-nums">
                  <span>{formatDuration(generatedAudio.durationSec)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatBytes(generatedAudio.sizeBytes)}</span>
                  <span aria-hidden="true">·</span>
                  <span>24kHz WAV</span>
                </div>
              </div>

              <WaveformPlayer
                audioBlob={generatedAudio.blob}
                title={clipTitle.trim() || generatedAudio.title}
                subtitle={`${generatedAudio.voiceName} · ${generatedAudio.beatCount} prosody beat${generatedAudio.beatCount === 1 ? "" : "s"}`}
                initialDurationSec={generatedAudio.durationSec}
              />

              {saveFeedback && (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                  {saveFeedback}
                </p>
              )}

              <div className="space-y-2.5 pt-1">
                {isDriveConnected ? (
                  <button
                    type="button"
                    onClick={() => handleSave(true)}
                    disabled={isSavingClip || !isOnline}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
                  >
                    <CloudUpload className="h-4 w-4" />
                    {isSavingClip
                      ? "Uploading to Drive..."
                      : "Save to Google Drive & Offline Vault"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onRequestGoogleSignIn}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50"
                  >
                    <CloudUpload className="h-4 w-4 text-blue-600" />
                    Sign in with Google to Save to Drive
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleSave(false)}
                  disabled={isSavingClip}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
                >
                  <HardDriveDownload className="h-3.5 w-3.5" />
                  Cache in Offline Vault Only
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
