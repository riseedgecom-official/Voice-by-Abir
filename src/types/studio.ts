export type ActiveTab = "studio" | "voices" | "library";
export type BaseGeminiVoice = "Puck" | "Charon" | "Kore" | "Fenrir" | "Zephyr";
export type SynthesisMode = "expressive" | "fast";

export interface VoiceDnaTraits {
  pitchHzEstimate: string;
  speakingWpm: string;
  accentTone: string;
  breathCadence: string;
  inflectionPattern: string;
  emotionalBaseline: string;
  sampleTranscript?: string;
}

export interface VoiceProfile {
  id: string;
  name: string;
  isPersonal: boolean;
  baseVoice: BaseGeminiVoice;
  stylePrompt: string;
  pitchLabel: string;
  paceLabel: string;
  timbreLabel: string;
  calibrationSummary: string;
  createdAt: string;
  sampleDurationSec?: number;
  voiceDna?: VoiceDnaTraits;
}

export interface ProsodyBeat {
  id: string;
  text: string;
  expressionLabel: string;
  styleDirective: string;
  pauseAfterMs: number;
}

export interface AudioClipRecord {
  id: string;
  title: string;
  voiceId: string;
  voiceName: string;
  sourceDocName: string;
  prosodySummary: string;
  durationSec: number;
  sizeBytes: number;
  createdAt: string;
  driveFileId?: string;
  driveWebViewLink?: string;
  cachedOffline: boolean;
  beatsCount: number;
  scriptPreview: string;
}
