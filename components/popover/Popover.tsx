"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Align = "start" | "center" | "end";
type Side = "top" | "bottom";

type PopoverContextValue = {
  openId: string | null;
  open: (id: string) => void;
  close: (id?: string) => void;
  toggle: (id: string) => void;
};

const PopoverContext = createContext<PopoverContextValue | null>(null);

/**
 * Coordinates which popover is open globally; opening one auto-closes any other.
 * Wrap the app once (in `AppProviders`) so every `<Popover>` shares the same state.
 */
export function PopoverProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const open = useCallback((id: string) => setOpenId(id), []);
  const close = useCallback(
    (id?: string) => setOpenId((cur) => (id === undefined || cur === id ? null : cur)),
    [],
  );
  const toggle = useCallback((id: string) => setOpenId((cur) => (cur === id ? null : id)), []);

  return (
    <PopoverContext.Provider value={{ openId, open, close, toggle }}>{children}</PopoverContext.Provider>
  );
}

/** Read or imperatively control the active popover (e.g. close all on route change). */
export function usePopoverController() {
  const ctx = useContext(PopoverContext);
  if (!ctx) throw new Error("usePopoverController must be used inside <PopoverProvider>");
  return ctx;
}

type TriggerRenderProps = {
  open: boolean;
  toggle: () => void;
  close: () => void;
  ref: (node: HTMLElement | null) => void;
};

type ContentRenderProps = {
  close: () => void;
};

type PopoverProps = {
  /**
   * Stable id used by {@link PopoverProvider} to ensure only one popover is open at a time.
   * Defaults to a generated id; pass explicitly when you need cross-component coordination.
   */
  id?: string;
  align?: Align;
  side?: Side;
  /** Gap between the trigger and the content, in px. */
  sideOffset?: number;
  /** Class applied to the portaled content wrapper (positioned with `fixed`). */
  contentClassName?: string;
  /** Match content width to trigger width (handy for combobox listboxes). */
  matchTriggerWidth?: boolean;
  trigger: (props: TriggerRenderProps) => ReactNode;
  children: ReactNode | ((props: ContentRenderProps) => ReactNode);
};

/**
 * Click-to-toggle popover that renders its content into `document.body` via portal so it can
 * never be clipped by a scrolling/`overflow-hidden` ancestor. Coordinates with siblings through
 * {@link PopoverProvider} when present, otherwise falls back to local open state.
 */
export function Popover({
  id: idProp,
  align = "end",
  side = "bottom",
  sideOffset = 8,
  contentClassName,
  matchTriggerWidth = false,
  trigger,
  children,
}: PopoverProps) {
  const ctx = useContext(PopoverContext);
  const fallbackId = useId();
  const id = idProp ?? fallbackId;

  const [localOpen, setLocalOpen] = useState(false);
  const open = ctx ? ctx.openId === id : localOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (ctx) {
        if (next) ctx.open(id);
        else ctx.close(id);
      } else {
        setLocalOpen(next);
      }
    },
    [ctx, id],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);
  const toggle = useCallback(() => {
    if (ctx) ctx.toggle(id);
    else setLocalOpen((v) => !v);
  }, [ctx, id]);

  const triggerRef = useRef<HTMLElement | null>(null);
  const setTriggerRef = useCallback((node: HTMLElement | null) => {
    triggerRef.current = node;
  }, []);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width?: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const updatePos = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const content = contentRef.current?.getBoundingClientRect();
      const cw = content?.width ?? 0;
      const ch = content?.height ?? 0;

      let top = side === "bottom" ? trigger.bottom + sideOffset : trigger.top - sideOffset - ch;
      let left = trigger.left;
      if (align === "end") left = trigger.right - cw;
      if (align === "center") left = trigger.left + trigger.width / 2 - cw / 2;

      const margin = 8;
      if (cw > 0) {
        const maxLeft = window.innerWidth - cw - margin;
        left = Math.max(margin, Math.min(left, maxLeft));
      }
      if (ch > 0) {
        const maxTop = window.innerHeight - ch - margin;
        top = Math.max(margin, Math.min(top, maxTop));
      }

      setPos({ top, left, width: matchTriggerWidth ? trigger.width : undefined });
    };
    updatePos();
    const raf = requestAnimationFrame(updatePos);
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open, align, side, sideOffset, matchTriggerWidth]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (contentRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  const triggerNode = trigger({ open, toggle, close, ref: setTriggerRef });

  if (!mounted || !open) return <>{triggerNode}</>;

  const style: React.CSSProperties = {
    position: "fixed",
    top: pos?.top ?? -9999,
    left: pos?.left ?? -9999,
    width: pos?.width,
    zIndex: 1000,
    visibility: pos ? "visible" : "hidden",
  };

  const content = (
    <div ref={contentRef} style={style} className={contentClassName}>
      {typeof children === "function" ? children({ close }) : children}
    </div>
  );

  return (
    <>
      {triggerNode}
      {createPortal(content, document.body)}
    </>
  );
}
