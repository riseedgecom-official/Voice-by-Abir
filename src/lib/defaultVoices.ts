import { VoiceProfile } from "../types/studio";

export const DEFAULT_STUDIO_VOICES: VoiceProfile[] = [
  {
    id: "preset-kore-narrator",
    name: "Studio Narrator",
    isPersonal: false,
    baseVoice: "Kore",
    stylePrompt:
      "Warm, balanced, and deeply human studio narrator. Clear diction with subtle conversational breathing and smooth dynamic range.",
    pitchLabel: "Balanced Mid",
    paceLabel: "Measured & Fluid",
    timbreLabel: "Warm & Clear",
    calibrationSummary: "Built-in studio voice calibrated for documentaries, audiobooks, and essays.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "preset-charon-executive",
    name: "Executive Keynote",
    isPersonal: false,
    baseVoice: "Charon",
    stylePrompt:
      "Grounded, resonant low-baritone speaker with composed authority, deliberate phrasing, and confident pauses before key insights.",
    pitchLabel: "Deep Baritone",
    paceLabel: "Deliberate & Steady",
    timbreLabel: "Rich & Resonant",
    calibrationSummary: "Built-in studio voice suited for executive briefings, manifestos, and keynotes.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "preset-puck-conversational",
    name: "Bright Host",
    isPersonal: false,
    baseVoice: "Puck",
    stylePrompt:
      "Energetic, articulate, and engaging podcast host with lively inflection, natural curiosity, and crisp upward momentum.",
    pitchLabel: "Bright Mid-High",
    paceLabel: "Lively & Expressive",
    timbreLabel: "Crisp & Animated",
    calibrationSummary: "Built-in studio voice ideal for product walkthroughs, explainers, and commentary.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "preset-fenrir-storyteller",
    name: "Fireside Storyteller",
    isPersonal: false,
    baseVoice: "Fenrir",
    stylePrompt:
      "Textured, intimate, and evocative storyteller who leans into dramatic contrast, soft suspense, and heartfelt warmth.",
    pitchLabel: "Mid-Low Tenor",
    paceLabel: "Rhythmic & Evocative",
    timbreLabel: "Textured & Intimate",
    calibrationSummary: "Built-in studio voice tailored for fiction, memoirs, and reflective prose.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "preset-zephyr-calm",
    name: "Calm Guide",
    isPersonal: false,
    baseVoice: "Zephyr",
    stylePrompt:
      "Airy, soothing, unhurried voice with gentle vocal softness, mindful cadence, and reassuring emotional poise.",
    pitchLabel: "Soft Alto",
    paceLabel: "Unhurried & Gentle",
    timbreLabel: "Velvety & Airy",
    calibrationSummary: "Built-in studio voice built for guided reading, wellness notes, and calm briefings.",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export interface SampleDocumentPreset {
  id: string;
  title: string;
  fileName: string;
  text: string;
  prosodyInstructions: string;
}

export const SAMPLE_DOCUMENTS: SampleDocumentPreset[] = [
  {
    id: "sample-keynote",
    title: "Product Reveal Draft",
    fileName: "product-reveal-keynote.txt",
    text: `For years, we treated spoken audio like a mechanical printout. You pasted a wall of text, hit render, and listened to a flat synthetic voice march across every comma without feeling.

Today, that changes. When you describe the pause before a revelation, the quiet warmth of an apology, or the spark of genuine excitement at the end of a chapter, your voice carries the real human intent behind the words.`,
    prosodyInstructions:
      "Open with a grounded, slightly skeptical conversational tone on the first paragraph. Pause thoughtfully before 'Today, that changes.' Deliver 'Today, that changes.' with crisp conviction, then shift into warm, inspiring enthusiasm through the final sentence.",
  },
  {
    id: "sample-story",
    title: "Midnight Harbor Passage",
    fileName: "midnight-harbor-chapter1.md",
    text: `The harbor lights flickered across the wet stone pier as the last ferry pulled away. Maya stood near the iron bollard, watching the wake widen into black water.

"You actually came," a voice called softly from the steps behind her. She turned, exhaled a slow breath into the cold air, and smiled for the first time all week.`,
    prosodyInstructions:
      "Read the opening scene quietly and atmospherically, unhurried. Give a subtle 800ms pause after 'black water.' Deliver 'You actually came,' in a hushed, surprised tone, add a soft breath before the final line, and close with genuine relief and warmth.",
  },
];
