import { useEffect, useRef, useState } from "react";
import { Check, Mic, Play, Square, Trash2, Upload, UserCheck } from "lucide-react";
import { BaseGeminiVoice, VoiceProfile } from "../types/studio";
import { base64ToBlob, formatDuration } from "../lib/audioUtils";
import { ConfirmDialog } from "./ConfirmDialog";

interface VoiceProfilesPanelProps {
  profiles: VoiceProfile[];
  selectedVoiceId: string;
  isOnline: boolean;
  onSelectVoiceForStudio: (voiceId: string) => void;
  onAddPersonalVoice: (profile: VoiceProfile) => Promise<void>;
  onUpdateVoiceStyle: (voiceId: string, stylePrompt: string) => Promise<void>;
  onUpdateVoiceBase: (voiceId: string, baseVoice: BaseGeminiVoice) => Promise<void>;
  onDeletePersonalVoice: (voiceId: string) => Promise<void>;
}

const CALIBRATION_SAMPLE_SCRIPT =
  "Hi, this is my natural speaking voice. When I tell a story, I like to slow down slightly on key details, keep my tone warm and conversational, and add clear energy when introducing a new idea.";

export function VoiceProfilesPanel({
  profiles,
  selectedVoiceId,
  isOnline,
  onSelectVoiceForStudio,
  onAddPersonalVoice,
  onUpdateVoiceStyle,
  onUpdateVoiceBase,
  onDeletePersonalVoice,
}: VoiceProfilesPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const meterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const [profileName, setProfileName] = useState("Abir — Personal Voice");
  const [customNotes, setCustomNotes] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [sampleBlob, setSampleBlob] = useState<Blob | null>(null);
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [auditioningId, setAuditioningId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<VoiceProfile | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (sampleUrl) URL.revokeObjectURL(sampleUrl);
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [sampleUrl]);

  const setRecordedSample = (blob: Blob) => {
    if (sampleUrl) URL.revokeObjectURL(sampleUrl);
    setSampleBlob(blob);
    setSampleUrl(URL.createObjectURL(blob));
  };

  const startRecording = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const drawMeter = () => {
        const canvas = meterCanvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            analyser.getByteFrequencyData(freqData);
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);
            const bars = 28;
            const gap = 3;
            const bw = (w - gap * (bars - 1)) / bars;
            for (let i = 0; i < bars; i++) {
              const val = freqData[i % freqData.length] / 255;
              const bh = Math.max(4, val * (h - 6));
              ctx.fillStyle = val > 0.45 ? "#2563EB" : "#94A3B8";
              ctx.beginPath();
              ctx.roundRect(i * (bw + gap), (h - bh) / 2, bw, bh, 1.5);
              ctx.fill();
            }
          }
        }
        animFrameRef.current = requestAnimationFrame(drawMeter);
      };
      drawMeter();

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        void audioCtx.close();
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType });
        setRecordedSample(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingSec(0);
      timerRef.current = window.setInterval(() => {
        setRecordingSec((s) => s + 1);
      }, 1000);
    } catch {
      setErrorMsg(
        "Microphone access was denied or unavailable. You can allow microphone access or upload an audio recording instead."
      );
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleCalibrateVoice = async () => {
    if (!sampleBlob) {
      setErrorMsg("Record your voice or upload an audio clip first.");
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsCalibrating(true);
    try {
      const formData = new FormData();
      const ext = sampleBlob.type.includes("wav")
        ? "wav"
        : sampleBlob.type.includes("mp3")
        ? "mp3"
        : "webm";
      formData.append("audio", sampleBlob, `voice-sample.${ext}`);
      formData.append("profileName", profileName.trim() || "My Personal Voice");
      formData.append("customNotes", customNotes.trim());

      const res = await fetch("/api/voice/calibrate", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Voice calibration failed.");
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
        sampleDurationSec: recordingSec || undefined,
        voiceDna: data.voiceDna,
      };

      await onAddPersonalVoice(newProfile);
      setSuccessMsg(
        `Extracted Voice DNA for "${newProfile.name}" (matched to ${newProfile.baseVoice}) and selected it for the Studio.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to calibrate voice.");
    } finally {
      setIsCalibrating(false);
    }
  };

  const handleAuditionVoice = async (profile: VoiceProfile) => {
    setErrorMsg(null);
    setAuditioningId(profile.id);
    try {
      const res = await fetch("/api/tts/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beats: [
            {
              text: `Hello, this is ${profile.name}. Every pause and shift in expression is guided by your direction.`,
              styleDirective: "Natural, clear studio introduction with warm vocal presence",
              pauseAfterMs: 0,
            },
          ],
          baseVoice: profile.baseVoice,
          voiceStylePrompt: profile.stylePrompt,
          modelMode: "expressive",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Audition failed.");
      }
      const blob = base64ToBlob(data.audioBase64, "audio/wav");
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not play audition.");
    } finally {
      setAuditioningId(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8">
      <div className="mb-6 border-b border-slate-200 pb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          Voice Profiles & Personal Calibration
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Record or upload a sample of your own voice so AI captures your pitch, cadence, warmth, and delivery style for personalized synthesis.
        </p>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {successMsg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 items-start">
        {/* Left: Personal Voice Recorder & Calibrator */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Capture Your Voice
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Speak naturally for 10–25 seconds using the prompt below, or upload a clean recording.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <p className="text-[11px] font-semibold text-slate-500">
              Suggested Calibration Script
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-800">
              "{CALIBRATION_SAMPLE_SCRIPT}"
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {!isRecording ? (
                  <button
                    type="button"
                    onClick={startRecording}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Mic className="h-3.5 w-3.5" />
                    Start Recording
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700 whitespace-nowrap shrink-0"
                  >
                    <Square className="h-3.5 w-3.5" />
                    Stop Recording
                  </button>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.wav,.mp3,.webm,.m4a,.ogg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setRecordedSample(file);
                      setRecordingSec(0);
                    }
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isRecording}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload Audio
                </button>
              </div>

              <span className="font-mono text-xs font-medium text-slate-600 tabular-nums">
                {formatDuration(recordingSec)}
              </span>
            </div>

            {isRecording && (
              <canvas
                ref={meterCanvasRef}
                width={360}
                height={44}
                className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 p-1"
              />
            )}

            {sampleUrl && !isRecording && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="mb-1.5 text-xs font-medium text-slate-600">
                  Recorded Sample Ready
                </p>
                <audio controls src={sampleUrl} className="h-9 w-full" />
              </div>
            )}
          </div>

          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div>
              <label
                htmlFor="voice-profile-name"
                className="block text-xs font-semibold text-slate-700"
              >
                Profile Name
              </label>
              <input
                id="voice-profile-name"
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="voice-custom-notes"
                className="block text-xs font-semibold text-slate-700"
              >
                Personal Delivery Notes (optional)
              </label>
              <input
                id="voice-custom-notes"
                type="text"
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
                placeholder="e.g., Warm, slightly husky mid-register, deliberate pauses"
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={handleCalibrateVoice}
              disabled={!sampleBlob || isCalibrating || !isOnline}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              <UserCheck className="h-4 w-4" />
              {isCalibrating ? "Analyzing Voice Sample..." : "Calibrate My Voice"}
            </button>
          </div>
        </div>

        {/* Right: Saved Voice Profiles List */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Available Voice Profiles ({profiles.length})
            </h2>
          </div>

          <div className="space-y-3">
            {profiles.map((profile) => {
              const isSelected = profile.id === selectedVoiceId;
              const isEditing = editingId === profile.id;

              return (
                <div
                  key={profile.id}
                  className={`rounded-xl border p-5 transition-colors ${
                    isSelected
                      ? "border-blue-500 bg-white"
                      : "border-slate-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <h3 className="font-display text-base font-semibold text-slate-900">
                          {profile.name}
                        </h3>
                        {isSelected && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600">
                            <Check className="h-3.5 w-3.5" />
                            Active in Studio
                          </span>
                        )}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-medium text-slate-700">
                          {profile.isPersonal ? "Personal Calibration" : "Studio Voice"}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>Timbre: {profile.baseVoice}</span>
                        <span aria-hidden="true">·</span>
                        <span>{profile.pitchLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span>{profile.paceLabel}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleAuditionVoice(profile)}
                        disabled={auditioningId === profile.id || !isOnline}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        <Play className="h-3.5 w-3.5" />
                        {auditioningId === profile.id ? "Playing..." : "Audition"}
                      </button>

                      <button
                        type="button"
                        onClick={() => onSelectVoiceForStudio(profile.id)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                          isSelected
                            ? "bg-blue-50 text-blue-700"
                            : "bg-slate-900 text-white hover:bg-slate-800"
                        }`}
                      >
                        {isSelected ? "Selected" : "Use in Studio"}
                      </button>

                      {profile.isPersonal && (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(profile)}
                          title="Delete personal voice profile"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="mt-3 space-y-2">
                      <textarea
                        value={editingPrompt}
                        onChange={(e) => setEditingPrompt(e.target.value)}
                        rows={2}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await onUpdateVoiceStyle(profile.id, editingPrompt);
                            setEditingId(null);
                          }}
                          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
                        >
                          Save Style
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 border-t border-slate-100 pt-3 space-y-3">
                      <p className="text-xs leading-relaxed text-slate-600">
                        {profile.stylePrompt}
                      </p>

                      {profile.voiceDna && (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-slate-100 bg-slate-50/70 p-3 text-[11px] sm:grid-cols-3">
                          <div>
                            <span className="block text-slate-400">Pitch Range</span>
                            <span className="font-medium text-slate-800">{profile.voiceDna.pitchHzEstimate}</span>
                          </div>
                          <div>
                            <span className="block text-slate-400">Cadence</span>
                            <span className="font-medium text-slate-800">{profile.voiceDna.speakingWpm}</span>
                          </div>
                          <div>
                            <span className="block text-slate-400">Accent & Tone</span>
                            <span className="font-medium text-slate-800">{profile.voiceDna.accentTone}</span>
                          </div>
                          <div>
                            <span className="block text-slate-400">Inflection</span>
                            <span className="font-medium text-slate-800">{profile.voiceDna.inflectionPattern}</span>
                          </div>
                          <div>
                            <span className="block text-slate-400">Breath Pattern</span>
                            <span className="font-medium text-slate-800">{profile.voiceDna.breathCadence}</span>
                          </div>
                          <div>
                            <span className="block text-slate-400">Baseline</span>
                            <span className="font-medium text-slate-800">{profile.voiceDna.emotionalBaseline}</span>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                        <span>{profile.calibrationSummary}</span>
                        <div className="flex items-center gap-3 shrink-0">
                          {profile.isPersonal && (
                            <label className="inline-flex items-center gap-1.5 text-slate-500">
                              <span>Foundation:</span>
                              <select
                                value={profile.baseVoice}
                                onChange={(e) =>
                                  void onUpdateVoiceBase(
                                    profile.id,
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
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(profile.id);
                              setEditingPrompt(profile.stylePrompt);
                            }}
                            className="font-medium text-slate-600 underline hover:text-slate-900 shrink-0"
                          >
                            Edit DNA Prompt
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="Delete Personal Voice Profile?"
        description={`Are you sure you want to remove "${confirmDelete?.name}"? Previously synthesized audio clips will remain intact.`}
        confirmLabel="Delete Profile"
        destructive
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) {
            await onDeletePersonalVoice(confirmDelete.id);
            setConfirmDelete(null);
          }
        }}
      />
    </div>
  );
}
