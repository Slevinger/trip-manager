"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/components/providers/I18nProvider";
import { formatGroupedNumber, parseGroupedNumberInput } from "@/lib/i18n/format";

type Props = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "onChange"
> & {
  value: number;
  onChange: (n: number) => void;
  /** When true, 0 shows as empty while not focused. */
  allowEmptyZero?: boolean;
  min?: number;
  maximumFractionDigits?: number;
};

export function GroupedNumberInput({
  value,
  onChange,
  allowEmptyZero,
  min = 0,
  maximumFractionDigits = 0,
  className,
  onFocus,
  onBlur,
  ...rest
}: Props) {
  const { locale } = useI18n();
  const [focused, setFocused] = useState(false);
  const [editText, setEditText] = useState("");
  const focusedRef = useRef(false);

  const displayBlurred =
    allowEmptyZero && value === 0
      ? ""
      : formatGroupedNumber(value, locale, { maximumFractionDigits });

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      className={className}
      value={focused ? editText : displayBlurred}
      onFocus={(e) => {
        focusedRef.current = true;
        setFocused(true);
        setEditText(allowEmptyZero && value === 0 ? "" : String(value));
        onFocus?.(e);
      }}
      onBlur={(e) => {
        focusedRef.current = false;
        setFocused(false);
        const parsed = parseGroupedNumberInput(editText);
        if (parsed === null) {
          if (allowEmptyZero && editText.trim() === "") onChange(0);
        } else {
          onChange(Math.max(min, parsed));
        }
        onBlur?.(e);
      }}
      onChange={(e) => {
        if (!focusedRef.current) return;
        const t = e.target.value;
        setEditText(t);
        const parsed = parseGroupedNumberInput(t);
        if (parsed === null) {
          if (allowEmptyZero && t.trim() === "") onChange(0);
          return;
        }
        onChange(Math.max(min, parsed));
      }}
    />
  );
}
