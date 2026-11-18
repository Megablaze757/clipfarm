/** Breaks a headline into balanced lines of at most ~max characters (mirrors the export's render.ts). */
export function wrapHeadline(text: string, max: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const total = words.join(' ').length
  const n = Math.max(1, Math.ceil(total / max))
  const target = total / n
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (cur && (next.length > max || (cur.length >= target && lines.length < n - 1))) { lines.push(cur); cur = w }
    else cur = next
  }
  if (cur) lines.push(cur)
  return lines
}
