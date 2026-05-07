"use client";

import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { I18nProvider } from "@/lib/i18n/context";
import { store } from "@/lib/store";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <Provider store={store}>
      <I18nProvider>{children}</I18nProvider>
    </Provider>
  );
}
