"use client";

import { formatAssistantReplyForMarkdown } from "@/lib/formatAssistantReplyMarkdown";
import { useEffect, useRef, useState } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

const markdownComponents: Components = {
  a({ href, children, ...rest }) {
    const external = href?.startsWith("http://") || href?.startsWith("https://");
    return (
      <a href={href} {...rest} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {children}
      </a>
    );
  },
};

type TripAssistantMessageBodyProps = {
  content: string;
  variant: "user" | "assistant";
  /** When true, messages taller than 4 lines are collapsed with a "read more" toggle. */
  collapsible?: boolean;
};

const BODY_CLASSES = `break-words text-sm leading-relaxed [&_a]:break-all [&_a]:font-medium [&_a]:underline [&_strong]:font-semibold [&_em]:italic [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_code]:rounded-md [&_code]:bg-black/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] dark:[&_code]:bg-white/10 [&_pre]:my-2 [&_pre]:max-h-48 [&_pre]:overflow-x-auto [&_pre]:overflow-y-auto [&_pre]:rounded-lg [&_pre]:bg-black/10 [&_pre]:p-2 [&_pre]:text-xs dark:[&_pre]:bg-black/25 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-300 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-600 dark:[&_blockquote]:border-zinc-600 dark:[&_blockquote]:text-zinc-400 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold`;

/** ~4 lines: text-sm (14px) × leading-relaxed (1.625) × 4 = ~91px */
const FOUR_LINES_PX = 92;

/**
 * Renders assistant/user chat lines as Markdown (**bold**, lists, `[label](url)` links).
 * GFM autolinks bare `https://…` / `http://…` URLs so pasted listings stay clickable (no raw HTML).
 */
export function TripAssistantMessageBody({ content, variant, collapsible }: TripAssistantMessageBodyProps) {
  const linkTone =
    variant === "user"
      ? "[&_a]:text-violet-900 dark:[&_a]:text-violet-200"
      : "[&_a]:text-violet-700 dark:[&_a]:text-violet-300";

  const markdown =
    variant === "assistant" ? formatAssistantReplyForMarkdown(content) : content;

  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    if (!collapsible) return;
    const el = bodyRef.current;
    if (!el) return;
    setOverflows(el.scrollHeight > FOUR_LINES_PX + 2);
  }, [collapsible, markdown]);

  if (!collapsible) {
    return (
      <div className={`${BODY_CLASSES} ${linkTone}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
          {markdown}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div>
      <div
        ref={bodyRef}
        style={!expanded ? { maxHeight: `${FOUR_LINES_PX}px`, overflow: "hidden" } : undefined}
        className={`${BODY_CLASSES} ${linkTone}`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownComponents}>
          {markdown}
        </ReactMarkdown>
      </div>
      {overflows && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 text-xs font-medium opacity-60 hover:opacity-90 transition-opacity"
        >
          … read more
        </button>
      )}
    </div>
  );
}
