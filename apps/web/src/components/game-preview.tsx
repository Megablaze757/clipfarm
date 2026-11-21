'use client'
import React, { useEffect, useRef } from 'react'
import { Canvas, GAME_H, GAME_HOOKS, GAME_W, hookStartSteps, makeGame } from '@/lib/games'

/** Runs one of our background games live — the same code the export uses. */
export function GamePreview({ id, className }: { id: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = ref.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const seed = Math.floor(Math.random() * 1e9)
    const game = makeGame(id, seed)
    const canvas = new Canvas()
    const img = ctx.createImageData(GAME_W, GAME_H)
    const dt = 1 / 30
    for (let i = 0, n = hookStartSteps(id, seed, 30); i < n; i++) game.step(dt)
    let raf = 0, last = performance.now(), acc = 0
    const tick = (now: number) => {
      acc += Math.min(0.25, (now - last) / 1000); last = now
      while (acc >= dt) { game.step(dt); acc -= dt }
      if (game.sfx) game.sfx.length = 0 // sounds are for the export; don't let them pile up here
      game.draw(canvas)
      const src = canvas.buf, dst = img.data
      for (let i = 0, j = 0; i < src.length; i += 3, j += 4) { dst[j] = src[i]; dst[j + 1] = src[i + 1]; dst[j + 2] = src[i + 2]; dst[j + 3] = 255 }
      ctx.putImageData(img, 0, 0)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [id])
  return (
    <div className="relative w-full h-full">
      <canvas ref={ref} width={GAME_W} height={GAME_H} className={className} />
      {GAME_HOOKS[id] && (
        <div className="absolute inset-x-0 bottom-[5%] text-center text-white text-[15px] tracking-wide pointer-events-none"
          style={{ fontFamily: 'Anton, Impact, sans-serif', textShadow: '0 0 3px #000, 0 0 3px #000, 0 2px 3px #000' }}>
          {GAME_HOOKS[id]}
        </div>
      )}
    </div>
  )
}
