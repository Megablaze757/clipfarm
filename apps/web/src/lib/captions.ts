/**
 * Caption look for the editor preview — mirrors apps/container/src/pipeline/captions.ts
 * (the export) so what you see is what you get.
 */
const POWER = new Set(["never", "always", "insane", "crazy", "million", "millions", "billion", "free", "secret", "best", "worst", "biggest",
  "literally", "everyone", "nobody", "money", "rich", "broke", "dead", "die", "kill", "killed", "love", "hate", "first", "last", "only", "wrong",
  "truth", "lie", "lied", "fired", "quit", "banned", "illegal", "impossible", "stupid", "genius", "shocking", "huge", "massive", "zero", "every", "cheat", "cheated", "scam"])

export function isPowerWord(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z0-9$%']/g, '')
  if (!w) return false
  if (/^\$?\d[\d,.]*(k|m|%|x)?$/.test(w) || /^\d/.test(w)) return true
  return POWER.has(w)
}

export interface CaptionLook { id: string; label: string; font: string; weight: number; upper: boolean; active: string; keyword: string | null; box: boolean; words: number }
export const CAPTION_LOOKS: CaptionLook[] = [
  { id: 'karaoke_yellow', label: 'Karaoke', font: 'Montserrat, "Arial Black", sans-serif', weight: 900, upper: true, active: '#ffe100', keyword: '#4af235', box: false, words: 3 },
  { id: 'bold_pop', label: 'Bold pop', font: 'Anton, Impact, sans-serif', weight: 400, upper: true, active: '#4af235', keyword: '#ffe100', box: false, words: 2 },
  { id: 'neon_box', label: 'Boxed', font: 'Montserrat, "Arial Black", sans-serif', weight: 800, upper: false, active: '#00ffff', keyword: '#ff66ff', box: true, words: 4 },
  { id: 'classic', label: 'Classic', font: 'Montserrat, "Arial Black", sans-serif', weight: 800, upper: false, active: '#ffffff', keyword: null, box: false, words: 5 },
]
export const lookFor = (id: string) => CAPTION_LOOKS.find((l) => l.id === id) ?? CAPTION_LOOKS[0]
