export const authFormVariants = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
};

export const authLoginScreenVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export const authDashboardScreenVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export const authFormTransition = {
  duration: 0.3,
  ease: [0.22, 1, 0.36, 1],
};

export const authLoginScreenTransition = {
  duration: 0.35,
  ease: [0.22, 1, 0.36, 1],
};

export const authDashboardScreenTransition = {
  duration: 0.35,
  ease: [0.22, 1, 0.36, 1],
};

export const getAuthMotionTransition = (prefersReducedMotion, transition) => (
  prefersReducedMotion ? { duration: 0 } : transition
);
