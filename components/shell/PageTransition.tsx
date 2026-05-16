"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useMemo, type ReactNode } from "react";

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const reduce = useReducedMotion();

  // Group all sub-routes of the same trip so tab navigations don't re-trigger the fade.
  const animationKey = useMemo(() => {
    const tripMatch = pathname.match(/^\/trip\/([^/]+)/);
    if (tripMatch) return `/trip/${tripMatch[1]}`;
    return pathname;
  }, [pathname]);

  const initial = reduce ? false : { opacity: 0 };
  const animate = { opacity: 1 };
  const exit = { opacity: 0 };

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={animationKey}
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
