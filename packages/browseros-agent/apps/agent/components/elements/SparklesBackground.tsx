import { SparklesCore } from '@/components/ui/sparkles'
import { cn } from '@/lib/utils'

interface SparklesBackgroundProps {
  className?: string
}

export function SparklesBackground({ className }: SparklesBackgroundProps) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        className,
      )}
      aria-hidden="true"
    >
      <div className="absolute top-0 left-0 h-[2px] w-full bg-gradient-to-r from-transparent via-primary/80 to-transparent blur-sm" />
      <div className="absolute top-0 left-0 h-px w-full bg-gradient-to-r from-transparent via-primary to-transparent" />
      <div className="absolute top-0 left-1/2 h-[6px] w-1/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-primary to-transparent blur-md" />
      <div className="absolute top-0 left-1/2 h-px w-1/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-primary to-transparent" />

      <SparklesCore
        background="transparent"
        minSize={0.7}
        maxSize={1.6}
        particleDensity={1800}
        className="absolute inset-0 h-full w-full opacity-55 dark:hidden"
        particleColor="#111827"
      />

      <SparklesCore
        background="transparent"
        minSize={0.7}
        maxSize={1.6}
        particleDensity={1800}
        className="absolute inset-0 hidden h-full w-full opacity-85 dark:block"
        particleColor="#F8FAFC"
      />

      <div className="absolute inset-0 bg-background/10 dark:bg-background/20" />
    </div>
  )
}
