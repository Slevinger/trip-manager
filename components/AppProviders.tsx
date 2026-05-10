"use client";

import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { PopoverProvider } from "@/components/popover/Popover";
import { I18nProvider } from "@/lib/i18n/context";
import { store } from "@/lib/store";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <Provider store={store}>
      <I18nProvider>
        <PopoverProvider>{children}</PopoverProvider>
      </I18nProvider>
    </Provider>
  );
}
