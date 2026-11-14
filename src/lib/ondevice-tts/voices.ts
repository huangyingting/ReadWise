/** English voices shipped with Paradee-8M v1.3 (en-US and en-GB). */
export const PARADEE_ENGLISH_VOICES = ["af_heart", "am_puck", "bf_isabella", "bm_fable"] as const;
export type ParadeeEnglishVoice = (typeof PARADEE_ENGLISH_VOICES)[number];
export const DEFAULT_PARADEE_VOICE: ParadeeEnglishVoice = "af_heart";

export function isParadeeEnglishVoice(voice: string): voice is ParadeeEnglishVoice {
  return (PARADEE_ENGLISH_VOICES as readonly string[]).includes(voice);
}
