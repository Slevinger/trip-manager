import type { DictNode } from "@/lib/i18n/dictionaries";

export function getByPath(root: DictNode, path: string): string | undefined {
  const parts = path.split(".");
  let cur: DictNode | undefined = root;
  for (const p of parts) {
    if (cur === undefined || typeof cur === "string") return undefined;
    cur = cur[p];
  }
  return typeof cur === "string" ? cur : undefined;
}
