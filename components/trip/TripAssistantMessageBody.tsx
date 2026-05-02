"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";

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
};

/**
 * Renders assistant/user chat lines as Markdown (**bold**, lists, links) with safe parsing (no raw HTML).
 */
export function TripAssistantMessageBody({ content, variant }: TripAssistantMessageBodyProps) {
  const linkTone =
    variant === "user"
      ? "[&_a]:text-violet-900 dark:[&_a]:text-violet-200"
      : "[&_a]:text-violet-700 dark:[&_a]:text-violet-300";

  return (
    <div
      className={`break-words text-sm leading-relaxed ${linkTone} [&_a]:break-all [&_a]:font-medium [&_a]:underline [&_strong]:font-semibold [&_em]:italic [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_code]:rounded-md [&_code]:bg-black/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] dark:[&_code]:bg-white/10 [&_pre]:my-2 [&_pre]:max-h-48 [&_pre]:overflow-x-auto [&_pre]:overflow-y-auto [&_pre]:rounded-lg [&_pre]:bg-black/10 [&_pre]:p-2 [&_pre]:text-xs dark:[&_pre]:bg-black/25 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-300 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-600 dark:[&_blockquote]:border-zinc-600 dark:[&_blockquote]:text-zinc-400 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold`}
    >
      <ReactMarkdown remarkPlugins={[remarkBreaks]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
