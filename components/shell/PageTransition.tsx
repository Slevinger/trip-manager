"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const reduce = useReducedMotion();
  // No translate `y`: a transformed ancestor breaks `position: fixed` (e.g. manage save bar).
  const initial = reduce ? false : { opacity: 0 };
  const animate = { opacity: 1 };
  const exit = { opacity: 0 };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={initial}
        animate={animate}
        exit={exit}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="min-h-full min-w-0 max-w-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
