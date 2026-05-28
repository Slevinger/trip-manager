"use client";

import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { ThemeProvider } from "next-themes";
import { PopoverProvider } from "@/components/popover/Popover";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n/context";
import { store } from "@/lib/store";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <Provider store={store}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <I18nProvider>
          <TooltipProvider delayDuration={120}>
            <PopoverProvider>{children}</PopoverProvider>
          </TooltipProvider>
        </I18nProvider>
      </ThemeProvider>
    </Provider>
  );
}
