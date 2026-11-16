export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  return h ? `${h}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${mins}:${String(secs).padStart(2, '0')}`
}

export function formatPrecise(ms: number): string {
  const s = Math.max(0, ms) / 1000
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}

export const SUBSCORE_LABELS: Record<string, string> = {
  hook: 'Hook',
  self_contained: 'Stands alone',
  complete: 'Complete',
  energy: 'Energy',
  structure: 'Setup → payoff',
  emotion: 'Emotion',
  shareability: 'Shareability',
  reaction: 'Reaction',
  novelty: 'Novelty',
}

export const CATEGORY_LABELS: Record<string, string> = {
  story: '📖 Story',
  hot_take: '🌶️ Hot take',
  surprising_fact: '🤯 Surprising fact',
  funny: '😂 Funny',
  practical_tip: '💡 Tip',
  emotional: '💥 Emotional',
  debate: '⚔️ Debate',
  quotable: '💬 Quotable',
  reveal: '👀 Reveal',
}
