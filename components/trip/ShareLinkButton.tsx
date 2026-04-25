"use client";

import { useState } from "react";
import { useI18n } from "@/components/providers/I18nProvider";

export function ShareLinkButton() {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
    >
      {copied ? t("common.copied") : t("share.copyLink")}
    </button>
  );
}
