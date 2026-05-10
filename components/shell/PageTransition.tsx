"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const reduce = useReducedMotion();
  const initial = reduce ? false : { opacity: 0, y: 8 };
  const animate = reduce ? { opacity: 1 } : { opacity: 1, y: 0 };
  const exit = reduce ? { opacity: 0 } : { opacity: 0, y: -8 };

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
