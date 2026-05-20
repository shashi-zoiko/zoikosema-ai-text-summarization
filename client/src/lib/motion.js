// Shared Framer Motion presets so every entrance/exit feels consistent.

export const easeOut = [0.16, 1, 0.3, 1]
export const easeSpring = [0.34, 1.56, 0.64, 1]

export const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.42, ease: easeOut } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2, ease: easeOut } },
}

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.28, ease: easeOut } },
  exit: { opacity: 0, transition: { duration: 0.18, ease: easeOut } },
}

export const scaleIn = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1, transition: { duration: 0.28, ease: easeSpring } },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.16, ease: easeOut } },
}

export const stagger = (delay = 0.06) => ({
  animate: { transition: { staggerChildren: delay } },
})

export const dockSpring = {
  type: 'spring',
  stiffness: 400,
  damping: 32,
  mass: 0.8,
}
