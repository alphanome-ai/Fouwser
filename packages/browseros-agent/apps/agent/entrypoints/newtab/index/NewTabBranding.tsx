import { motion } from 'motion/react'
import type { FC } from 'react'

export const NewTabBranding: FC = () => {
  return (
    <div className="space-y-4 text-center">
      <div className="mb-2 flex items-center justify-center gap-3">
        <motion.div
          layoutId="new-tab-branding"
          transition={{
            type: 'keyframes',
            damping: 20,
            stiffness: 300,
          }}
          className="flex w-full items-center justify-center py-3"
        >
          <h1 className="font-semibold text-4xl tracking-tight sm:text-5xl md:text-6xl">
            Ask Fouwser
          </h1>
        </motion.div>
      </div>
    </div>
  )
}
