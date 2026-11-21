import { useEffect, useRef, useState } from "react";
import { Download, Pause, Play } from "lucide-react";
import {
  extractWaveformPeaks,
  formatDuration,
  triggerBlobDownload,
} from "../lib/audioUtils";

interface WaveformPlayerProps {
  audioBlob: Blob;
  title: string;
  subtitle?: string;
  initialDurationSec?: number;
  compact?: boolean;
}

const SPEED_OPTIONS = [0.85, 1, 1.15, 1.25];

export function WaveformPlayer({
  audioBlob,
  title,
  subtitle,
  initialDurationSec = 0,
  compact = false,
}: WaveformPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(initialDurationSec);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    const url = URL.createObjectURL(audioBlob);
    setAudioUrl(url);
    setIsPlaying(false);
    setCurrentTime(0);

    let cancelled = false;
    extractWaveformPeaks(audioBlob, compact ? 48 : 72)
      .then((res) => {
        if (!cancelled) {
          setPeaks(res.peaks);
          if (res.durationSec > 0) setDuration(res.durationSec);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPeaks(Array.from({ length: compact ? 48 : 72 }, (_, i) => 0.25 + ((i * 19) % 55) / 100));
        }
      });

    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [audioBlob, compact]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
    const barGap = 2;
    const barWidth = Math.max(2, (width - barGap * (peaks.length - 1)) / peaks.length);

    peaks.forEach((peak, idx) => {
      const x = idx * (barWidth + barGap);
      const barRatio = idx / peaks.length;
      const barH = Math.max(4, peak * (height - 8));
      const y = (height - barH) / 2;

      ctx.fillStyle = barRatio <= progress ? "#2563EB" : "#CBD5E1";
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barH, 1.5);
      ctx.fill();
    });
  }, [peaks, currentTime, duration]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      try {
        await audio.play();
      } catch {
        setIsPlaying(false);
      }
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio || duration <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  };

  const cycleSpeed = () => {
    const idx = SPEED_OPTIONS.indexOf(playbackRate);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setPlaybackRate(next);
  };

  const safeDownloadName = `${title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || "voice-clip"}.wav`;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            setCurrentTime(0);
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            if (Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0) {
              setDuration(e.currentTarget.duration);
            }
          }}
        />
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
          {subtitle && (
            <p className="truncate text-xs text-slate-500">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={cycleSpeed}
            title="Adjust playback speed"
            className="rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 tabular-nums whitespace-nowrap shrink-0"
          >
            {playbackRate}x
          </button>
          <button
            type="button"
            onClick={() => triggerBlobDownload(audioBlob, safeDownloadName)}
            title="Download WAV file"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? "Pause audio" : "Play audio"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
        </button>

        <canvas
          ref={canvasRef}
          onClick={handleSeek}
          title="Click anywhere on waveform to seek"
          className="h-11 w-full cursor-pointer"
        />

        <div className="font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap shrink-0">
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </div>
      </div>
    </div>
  );
}
