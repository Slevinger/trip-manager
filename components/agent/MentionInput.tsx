"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Lock, Users } from "lucide-react";
import { cn } from "@/lib/ui/cn";

// ─── Built-in tag suggestions ────────────────────────────────────────────────

interface TagSuggestion {
  tag: string;
  hint: string;
  icon?: "lock" | "users";
}

const SUGGESTIONS: TagSuggestion[] = [
  { tag: "@private", hint: "Only visible to you", icon: "lock" },
  { tag: "@all", hint: "Visible to everyone", icon: "users" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Return the `@fragment` being typed immediately before `cursorPos`, or null. */
function getAtFragment(
  text: string,
  cursorPos: number
): { fragment: string; start: number } | null {
  const m = text.slice(0, cursorPos).match(/@([A-Za-z0-9_.-]*)$/);
  if (!m) return null;
  return { fragment: m[0], start: cursorPos - m[0].length };
}

/** Render plain text with `@mention` and `[action-tag]` tokens as coloured chips. */
function renderHighlighted(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/(@[A-Za-z0-9_.-]+|\[[\w-]+\])/g)) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    const isActionTag = token.startsWith("[");
    const tag = token.toLowerCase();
    nodes.push(
      <mark
        key={m.index}
        className={cn(
          "rounded px-1 not-italic font-medium",
          isActionTag
            ? "bg-[var(--color-brand)]/15 text-[var(--color-brand)]"
            : tag === "@private"
              ? "bg-[var(--color-brand)]/20 text-[var(--color-brand)]"
              : tag === "@all"
                ? "bg-[var(--color-surface-muted)] text-[var(--color-muted-foreground)]"
                : "bg-[color-mix(in_oklab,var(--color-brand)_12%,transparent)] text-[var(--color-brand)]"
        )}
      >
        {token}
      </mark>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  // Sentinel keeps the last empty line the same height as the textarea.
  nodes.push("\u200b");
  return nodes;
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface MentionInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const MAX_HEIGHT_PX = 168; // ~6 lines at text-sm / leading-relaxed

export function MentionInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  className,
}: MentionInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  // Call synchronously so height is correct on the same frame as the input.
  function autoResize(ta: HTMLTextAreaElement) {
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_HEIGHT_PX)}px`;
    ta.style.overflowY = ta.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
  }

  // Resize when value is changed externally (e.g. pendingDraft restore).
  useEffect(() => {
    if (textareaRef.current) autoResize(textareaRef.current);
  }, [value]);

  // ── Autocomplete logic ───────────────────────────────────────────────────

  function refreshSuggestions(text: string, cursorPos: number) {
    const frag = getAtFragment(text, cursorPos);
    if (!frag) {
      setSuggestions([]);
      return;
    }
    const lower = frag.fragment.toLowerCase();
    const hits = SUGGESTIONS.filter((s) => s.tag.toLowerCase().startsWith(lower));
    setSuggestions(hits);
    setActiveIdx(0);
  }

  function applySuggestion(s: TagSuggestion) {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart ?? value.length;
    const frag = getAtFragment(value, pos);
    const insertAt = frag ? frag.start : pos;
    const next = value.slice(0, insertAt) + s.tag + " " + value.slice(pos);
    onChange(next);
    setSuggestions([]);
    const newPos = insertAt + s.tag.length + 1;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
    });
  }

  // ── Event handlers ───────────────────────────────────────────────────────

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    // Resize immediately (same frame) so there's no single-frame height flash.
    autoResize(e.target);
    onChange(e.target.value);
    refreshSuggestions(e.target.value, e.target.selectionStart ?? e.target.value.length);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        applySuggestion(suggestions[activeIdx]);
        return;
      }
      if (e.key === "Escape") {
        setSuggestions([]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }

  function handleCursorMove() {
    const ta = textareaRef.current;
    if (!ta) return;
    refreshSuggestions(value, ta.selectionStart ?? value.length);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={cn("relative min-h-10 flex-1", className)}>
      {/*
       * Mirror div — absolutely fills the textarea, same font + padding, renders
       * styled @tag chips. Pointer events are disabled so it never captures clicks.
       * overflow is hidden so it never shows its own scrollbar.
       */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl px-3 py-2 text-sm leading-relaxed text-[var(--color-foreground)]"
        style={{ fontFamily: "inherit", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {value ? renderHighlighted(value) : null}
      </div>

      {/*
       * Actual textarea — grows up to MAX_HEIGHT_PX then scrolls.
       * bg-transparent lets the mirror show through.
       * color: transparent keeps only the caret visible; placeholder retains
       * its own colour via ::placeholder which doesn't inherit color.
       */}
      <textarea
        ref={textareaRef}
        value={value}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={handleCursorMove}
        onClick={handleCursorMove}
        spellCheck
        className="relative z-10 min-h-10 w-full resize-none rounded-2xl border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-[var(--color-muted-foreground)] focus:ring-1 focus:ring-[var(--color-brand)]"
        style={{ color: "transparent", caretColor: "var(--color-foreground)", overflowY: "hidden" }}
      />

      {/* Autocomplete dropdown */}
      {suggestions.length > 0 && (
        <div className="absolute bottom-full left-0 z-50 mb-1.5 min-w-[200px] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          {suggestions.map((s, i) => (
            <button
              key={s.tag}
              type="button"
              onMouseDown={(e) => {
                // Prevent textarea blur before we can read selectionStart.
                e.preventDefault();
                applySuggestion(s);
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                i === activeIdx
                  ? "bg-[var(--color-surface-muted)]"
                  : "hover:bg-[var(--color-surface-muted)]"
              )}
            >
              {s.icon === "lock" ? (
                <Lock className="h-3.5 w-3.5 shrink-0 text-[var(--color-brand)]" />
              ) : s.icon === "users" ? (
                <Users className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
              ) : null}
              <span className="font-medium text-[var(--color-foreground)]">{s.tag}</span>
              <span className="text-xs text-[var(--color-muted-foreground)]">{s.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
