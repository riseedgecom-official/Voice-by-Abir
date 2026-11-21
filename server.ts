import "dotenv/config";
import express from "express";
import multer from "multer";
import mammoth from "mammoth";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const VALID_VOICES = new Set(["Puck", "Charon", "Kore", "Fenrir", "Zephyr"]);

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function extractPcmFromWav(wavBuffer: Buffer): {
  pcm: Buffer;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
} {
  if (wavBuffer.length < 44 || wavBuffer.toString("ascii", 0, 4) !== "RIFF") {
    return { pcm: wavBuffer, sampleRate: 24000, channels: 1, bitsPerSample: 16 };
  }

  const channels = wavBuffer.readUInt16LE(22) || 1;
  const sampleRate = wavBuffer.readUInt32LE(24) || 24000;
  const bitsPerSample = wavBuffer.readUInt16LE(34) || 16;

  // Locate the "data" subchunk cleanly instead of assuming fixed 44-byte offset
  let offset = 12;
  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.toString("ascii", offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      const start = offset + 8;
      const end = Math.min(wavBuffer.length, start + chunkSize);
      return {
        pcm: wavBuffer.subarray(start, end),
        sampleRate,
        channels,
        bitsPerSample,
      };
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  return {
    pcm: wavBuffer.subarray(44),
    sampleRate,
    channels,
    bitsPerSample,
  };
}

function buildWavBuffer(
  pcmData: Buffer,
  sampleRate = 24000,
  channels = 1,
  bitsPerSample = 16
): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  header.writeUInt16LE(1, 20); // AudioFormat = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}

function parseGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("API_KEY_INVALID") || raw.includes("400")) {
    return {
      status: 400,
      message: "Gemini API request error. Please verify your API key in Settings > Secrets.",
    };
  }
  if (raw.includes("PERMISSION_DENIED") || raw.includes("403")) {
    return {
      status: 403,
      message: "Permission denied by Gemini API. Check your API key in Settings > Secrets.",
    };
  }
  if (raw.includes("RESOURCE_EXHAUSTED") || raw.includes("429")) {
    return {
      status: 429,
      message: "Rate limit reached. Please wait a moment and try again.",
    };
  }
  return { status: 500, message: raw || "Unexpected server error." };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  // 1. Document text extraction (.txt, .md, .csv, .json, .docx, .pdf)
  app.post("/api/documents/extract", upload.single("file"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "No document file uploaded." });
        return;
      }

      const ext = path.extname(file.originalname).toLowerCase();
      let extractedText = "";

      if ([".txt", ".md", ".csv", ".json", ".srt", ".vtt"].includes(ext) || file.mimetype.startsWith("text/")) {
        extractedText = file.buffer.toString("utf-8").trim();
      } else if (ext === ".docx" || file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        extractedText = result.value.trim();
      } else if (ext === ".pdf" || file.mimetype === "application/pdf") {
        const ai = getAiClient();
        const response = await ai.models.generateContent({
          model: "gemini-4-hydrogen",
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: file.buffer.toString("base64"),
                },
              },
              {
                text: "Extract all readable body text from this PDF document verbatim in reading order. Preserve natural paragraph breaks. Omit running page headers, page numbers, and decorative watermarks. Return only the extracted text with no extra commentary.",
              },
            ],
          },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });
        extractedText = (response.text ?? "").trim();
      } else {
        res.status(400).json({
          error: `Unsupported file type (${ext || file.mimetype}). Upload .txt, .md, .docx, .pdf, or .csv files.`,
        });
        return;
      }

      if (!extractedText) {
        res.status(422).json({ error: "No readable text could be extracted from that document." });
        return;
      }

      const words = extractedText.split(/\s+/).filter(Boolean).length;
      res.json({
        fileName: file.originalname,
        text: extractedText,
        wordCount: words,
        charCount: extractedText.length,
      });
    } catch (err) {
      const parsed = parseGeminiError(err);
      res.status(parsed.status).json({ error: parsed.message });
    }
  });

  // 2. Natural-language AI Prosody Direction
  app.post("/api/prosody/direct", async (req, res) => {
    try {
      const { rawText, prosodyInstructions, voiceName, voiceStylePrompt } = req.body ?? {};
      if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
        res.status(400).json({ error: "Document text is required for prosody direction." });
        return;
      }

      const ai = getAiClient();
      const instructionsText =
        typeof prosodyInstructions === "string" && prosodyInstructions.trim()
          ? prosodyInstructions.trim()
          : "Deliver naturally with human pacing, subtle warmth, clear emphasis on key ideas, and natural breath pauses between shifts in thought.";

      const prompt = `You are an expert speech director preparing a text script for expressive human-sounding text-to-speech synthesis.

TASK:
1. Segment the provided script into natural, cohesive spoken beats (between 1 and 12 beats depending on length) aligned with emotional shifts, pauses, or emphasis transitions described by the user.
2. Preserve the speaker's exact words from the script. Strip any inline bracketed stage directions like [pause 1s] or [whisper softly] from the spoken "text" field and translate them into the beat's "styleDirective", "pauseAfterMs", or subtle vocal burst tags (<breath>, <laugh>, <gasp>) ONLY where explicitly implied by the user's directions.
3. For each beat, write a clear, vivid "styleDirective" (1-2 sentences describing tone, vocal energy, inflection, pace, and emotion) and a short 2-4 word "expressionLabel".
4. Set "pauseAfterMs" (0 to 2500) to capture deliberate dramatic pauses, breath breaks, or paragraph transitions.

VOICE PERSONA CONTEXT:
Speaker: ${voiceName || "Narrator"}
Base vocal profile: ${voiceStylePrompt || "Warm, clear, natural human narrator"}

USER'S NATURAL-LANGUAGE EXPRESSION INSTRUCTIONS:
${instructionsText}

SCRIPT TEXT:
${rawText.trim()}`;

      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description: "One-sentence overview of the overall emotional arc.",
              },
              beats: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: {
                      type: Type.STRING,
                      description: "Exact spoken words for this beat (no bracketed stage notes).",
                    },
                    expressionLabel: {
                      type: Type.STRING,
                      description: "Short 2-4 word label summarizing the delivery.",
                    },
                    styleDirective: {
                      type: Type.STRING,
                      description: "Detailed natural-language prosody instruction for speech synthesis.",
                    },
                    pauseAfterMs: {
                      type: Type.INTEGER,
                      description: "Silence pause duration in milliseconds after this beat (0 to 2500).",
                    },
                  },
                  required: ["text", "expressionLabel", "styleDirective", "pauseAfterMs"],
                },
              },
            },
            required: ["summary", "beats"],
          },
        },
      });

      const parsedJson = JSON.parse((response.text ?? "{}").trim());
      const beats = Array.isArray(parsedJson.beats)
        ? parsedJson.beats.map((b: Record<string, unknown>, idx: number) => ({
            id: `beat-${Date.now()}-${idx}`,
            text: String(b.text ?? "").trim(),
            expressionLabel: String(b.expressionLabel ?? "Natural delivery").trim(),
            styleDirective: String(b.styleDirective ?? "Natural conversational tone").trim(),
            pauseAfterMs: Math.max(0, Math.min(3000, Number(b.pauseAfterMs) || 0)),
          })).filter((b: { text: string }) => b.text.length > 0)
        : [];

      if (beats.length === 0) {
        res.status(422).json({ error: "Could not segment prosody beats from this script." });
        return;
      }

      res.json({
        summary: String(parsedJson.summary ?? "Natural prosody arc applied."),
        beats,
      });
    } catch (err) {
      const parsed = parseGeminiError(err);
      res.status(parsed.status).json({ error: parsed.message });
    }
  });

  // 3. Personal Voice DNA Extraction from sample voice recording or upload
  app.post("/api/voice/calibrate", upload.single("audio"), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Please record or upload a voice sample audio file." });
        return;
      }

      const profileName = String(req.body?.profileName || "Sampled Voice DNA").trim();
      const customNotes = String(req.body?.customNotes || "").trim();
      const mimeType = file.mimetype || "audio/webm";

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType,
                data: file.buffer.toString("base64"),
              },
            },
            {
              text: `Listen closely and forensically to this sample voice recording to extract its exact Voice DNA so a text-to-speech engine can replicate the speaker's vocal identity, cadence, timbre, accent, and delivery habits on any new script.
${customNotes ? `User's additional direction: ${customNotes}` : ""}

First, choose the closest vocal foundation from these 5 options based on fundamental pitch, gender register, and resonance:
- "Charon": Deep, grounded, authoritative low-register male voice
- "Fenrir": Textured, warm-gravel, mid-low expressive male voice
- "Puck": Bright, crisp, upbeat mid-high voice
- "Kore": Warm, clear, balanced mid-register natural voice
- "Zephyr": Light, airy, smooth expressive voice

Then extract the full Voice DNA JSON:
- matchedBaseVoice: exact name from the 5 options above
- stylePrompt: dense, hyper-specific 3-4 sentence Voice DNA replication directive describing vocal cord weight, breathiness, chest vs head resonance, pitch contour, consonant crispness, accent coloration, and sentence-ending cadence
- pitchLabel: concise 2-word pitch register description
- paceLabel: concise 2-3 word speaking cadence description
- timbreLabel: concise 2-3 word vocal texture description
- calibrationSummary: 1-2 sentence summary of the voice DNA captured
- pitchHzEstimate: estimated pitch range (e.g. "105-145 Hz Low Baritone")
- speakingWpm: estimated pace (e.g. "138 WPM · Measured")
- accentTone: detected regional accent / pronunciation style (e.g. "Neutral South Asian English, soft R's")
- breathCadence: breath & pause habit (e.g. "Soft inhale before clauses, micro-pauses on commas")
- inflectionPattern: how pitch rises/falls (e.g. "Gentle upward lift mid-phrase, warm downward resolve")
- emotionalBaseline: baseline emotional color (e.g. "Calm, attentive, subtly warm")
- sampleTranscript: brief verbatim transcript of what was spoken in the sample`,
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              matchedBaseVoice: { type: Type.STRING },
              stylePrompt: { type: Type.STRING },
              pitchLabel: { type: Type.STRING },
              paceLabel: { type: Type.STRING },
              timbreLabel: { type: Type.STRING },
              calibrationSummary: { type: Type.STRING },
              pitchHzEstimate: { type: Type.STRING },
              speakingWpm: { type: Type.STRING },
              accentTone: { type: Type.STRING },
              breathCadence: { type: Type.STRING },
              inflectionPattern: { type: Type.STRING },
              emotionalBaseline: { type: Type.STRING },
              sampleTranscript: { type: Type.STRING },
            },
            required: [
              "matchedBaseVoice",
              "stylePrompt",
              "pitchLabel",
              "paceLabel",
              "timbreLabel",
              "calibrationSummary",
              "pitchHzEstimate",
              "speakingWpm",
              "accentTone",
              "breathCadence",
              "inflectionPattern",
              "emotionalBaseline",
              "sampleTranscript",
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? "{}").trim());
      const matchedBaseVoice = VALID_VOICES.has(parsed.matchedBaseVoice)
        ? parsed.matchedBaseVoice
        : "Kore";

      res.json({
        profileName,
        matchedBaseVoice,
        stylePrompt: String(parsed.stylePrompt || "Warm, natural, expressive personal delivery."),
        pitchLabel: String(parsed.pitchLabel || "Balanced Mid"),
        paceLabel: String(parsed.paceLabel || "Natural Conversational"),
        timbreLabel: String(parsed.timbreLabel || "Warm & Clear"),
        calibrationSummary: String(
          parsed.calibrationSummary || "Captured vocal DNA, cadence, pitch contour, and phrasing."
        ),
        voiceDna: {
          pitchHzEstimate: String(parsed.pitchHzEstimate || "Balanced Mid Register"),
          speakingWpm: String(parsed.speakingWpm || "~140 WPM"),
          accentTone: String(parsed.accentTone || "Natural conversational articulation"),
          breathCadence: String(parsed.breathCadence || "Natural breath pauses at clause breaks"),
          inflectionPattern: String(parsed.inflectionPattern || "Smooth conversational contour"),
          emotionalBaseline: String(parsed.emotionalBaseline || "Warm and attentive"),
          sampleTranscript: String(parsed.sampleTranscript || ""),
        },
      });
    } catch (err) {
      const parsed = parseGeminiError(err);
      res.status(parsed.status).json({ error: parsed.message });
    }
  });

  // 4. Expressive Multi-Beat Speech Synthesis
  app.post("/api/tts/synthesize", async (req, res) => {
    try {
      const { beats, baseVoice, voiceStylePrompt, modelMode } = req.body ?? {};
      if (!Array.isArray(beats) || beats.length === 0) {
        res.status(400).json({ error: "At least one prosody beat is required for speech synthesis." });
        return;
      }

      const voiceName = VALID_VOICES.has(baseVoice) ? baseVoice : "Kore";
      const ttsModel =
        modelMode === "fast" ? "gemini-3.8-flash-lite-tts" : "gemini-3.8-flash-tts";
      const ai = getAiClient();

      const pcmSegments: Buffer[] = [];
      let detectedSampleRate = 24000;
      let detectedChannels = 1;
      let detectedBitsPerSample = 16;

      for (let i = 0; i < beats.length; i++) {
        const beat = beats[i] as {
          text?: string;
          styleDirective?: string;
          pauseAfterMs?: number;
        };
        const text = String(beat.text ?? "").trim();
        if (!text) continue;

        const combinedStyle = [
          voiceStylePrompt ? `Replicate this Voice DNA consistently: ${String(voiceStylePrompt).trim()}.` : "",
          beat.styleDirective ? `Expression and prosody for this beat: ${String(beat.styleDirective).trim()}.` : "",
        ]
          .filter(Boolean)
          .join(" ");

        const response = await ai.models.generateContent({
          model: ttsModel,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text,
                  speechMetadata: combinedStyle ? { style: combinedStyle } : undefined,
                },
              ],
            },
          ],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) {
          throw new Error(`No audio was returned for beat ${i + 1}.`);
        }

        const wavBuf = Buffer.from(base64Audio, "base64");
        const { pcm, sampleRate, channels, bitsPerSample } = extractPcmFromWav(wavBuf);
        detectedSampleRate = sampleRate;
        detectedChannels = channels;
        detectedBitsPerSample = bitsPerSample;
        pcmSegments.push(pcm);

        const pauseMs = Math.max(0, Math.min(3000, Number(beat.pauseAfterMs) || 0));
        if (pauseMs > 0 && i < beats.length - 1) {
          const bytesPerSecond = (detectedSampleRate * detectedChannels * detectedBitsPerSample) / 8;
          const silenceBytes = Math.round((pauseMs / 1000) * bytesPerSecond);
          // Align to block boundary (2 bytes for 16-bit mono)
          const blockAlign = (detectedChannels * detectedBitsPerSample) / 8;
          const alignedSilenceBytes = silenceBytes - (silenceBytes % blockAlign);
          if (alignedSilenceBytes > 0) {
            pcmSegments.push(Buffer.alloc(alignedSilenceBytes, 0));
          }
        }
      }

      if (pcmSegments.length === 0) {
        res.status(422).json({ error: "No spoken text found to synthesize." });
        return;
      }

      const fullPcm = Buffer.concat(pcmSegments);
      const finalWav = buildWavBuffer(
        fullPcm,
        detectedSampleRate,
        detectedChannels,
        detectedBitsPerSample
      );
      const bytesPerSecond = (detectedSampleRate * detectedChannels * detectedBitsPerSample) / 8;
      const durationSec = Number((fullPcm.length / bytesPerSecond).toFixed(2));

      res.json({
        audioBase64: finalWav.toString("base64"),
        mimeType: "audio/wav",
        durationSec,
        sizeBytes: finalWav.length,
        sampleRate: detectedSampleRate,
        beatCount: beats.length,
      });
    } catch (err) {
      const parsed = parseGeminiError(err);
      res.status(parsed.status).json({ error: parsed.message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, "dist");
    app.use(express.static(distDir));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Voice by Abir server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
