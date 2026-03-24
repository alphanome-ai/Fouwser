import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

interface SparklesCoreProps {
  background?: string
  minSize?: number
  maxSize?: number
  particleDensity?: number
  className?: string
  particleColor?: string
}

interface Particle {
  x: number
  y: number
  size: number
  opacity: number
  twinkle: number
  vx: number
  vy: number
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

const randomBetween = (min: number, max: number) =>
  Math.random() * (max - min) + min

export function SparklesCore({
  background = 'transparent',
  minSize = 0.4,
  maxSize = 1,
  particleDensity = 1200,
  className,
  particleColor = '#FFFFFF',
}: SparklesCoreProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const parent = canvas.parentElement
    if (!ctx || !parent) return

    let width = 0
    let height = 0
    let frameId = 0
    let particles: Particle[] = []
    const particleCount = clamp(Math.floor(particleDensity / 8), 40, 220)

    const createParticle = (): Particle => ({
      x: randomBetween(0, width),
      y: randomBetween(0, height),
      size: randomBetween(minSize, maxSize),
      opacity: randomBetween(0.2, 0.9),
      twinkle: randomBetween(0.004, 0.012) * (Math.random() > 0.5 ? 1 : -1),
      vx: randomBetween(-0.08, 0.08),
      vy: randomBetween(-0.08, 0.08),
    })

    const resetParticles = () => {
      particles = Array.from({ length: particleCount }, createParticle)
    }

    const resize = () => {
      width = parent.clientWidth
      height = parent.clientHeight

      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      resetParticles()
    }

    const draw = () => {
      if (background === 'transparent') {
        ctx.clearRect(0, 0, width, height)
      } else {
        ctx.fillStyle = background
        ctx.fillRect(0, 0, width, height)
      }

      ctx.fillStyle = particleColor

      particles.forEach((particle) => {
        particle.x += particle.vx
        particle.y += particle.vy

        if (particle.x < -4) particle.x = width + 4
        if (particle.x > width + 4) particle.x = -4
        if (particle.y < -4) particle.y = height + 4
        if (particle.y > height + 4) particle.y = -4

        particle.opacity += particle.twinkle
        if (particle.opacity > 0.92 || particle.opacity < 0.15) {
          particle.twinkle *= -1
        }

        ctx.globalAlpha = particle.opacity
        ctx.beginPath()
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
        ctx.fill()
      })

      ctx.globalAlpha = 1
      frameId = requestAnimationFrame(draw)
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(parent)

    resize()
    frameId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
    }
  }, [background, maxSize, minSize, particleColor, particleDensity])

  return <canvas ref={canvasRef} className={cn('h-full w-full', className)} />
}
