"use client";

import { useCallback, useMemo } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { getByPath } from "@/lib/i18n/paths";

export function useT(locale: Locale) {
  const table = useMemo(() => dictionaries[locale], [locale]);

  return useCallback(
    (key: string) => {
      const direct = getByPath(table, key);
      if (direct) return direct;
      const en = getByPath(dictionaries.en, key);
      if (en) return en;
      return key;
    },
    [table]
  );
}
