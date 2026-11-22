"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  applyTheme,
  readThemeChoice,
  saveThemeChoice,
  type ThemeChoice,
} from "@/lib/theme";

const ORDER: ThemeChoice[] = ["system", "light", "dark"];
const META = {
  system: { label: "System", Icon: Monitor },
  light: { label: "Light", Icon: Sun },
  dark: { label: "Dark", Icon: Moon },
} as const;

/** One button that cycles System → Light → Dark. The choice persists in localStorage. */
export function ThemeToggle() {
  // null until mounted: the server can't know the stored choice
  const [choice, setChoice] = useState<ThemeChoice | null>(null);

  useEffect(() => {
    setChoice(readThemeChoice());
  }, []);

  // In System mode, follow OS changes live
  useEffect(() => {
    if (choice !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [choice]);

  const current = choice ?? "system";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const { label, Icon } = META[current];

  return (
    <button
      type="button"
      onClick={() => {
        saveThemeChoice(next);
        applyTheme(next);
        setChoice(next);
      }}
      aria-label={`Theme: ${label}. Switch to ${META[next].label}`}
      title={`Theme: ${label} (click for ${META[next].label})`}
      className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:border-brand-ink/40 hover:text-brand-ink ${
        choice === null ? "opacity-0" : ""
      }`}
    >
      <Icon aria-hidden className="h-3.5 w-3.5" />
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
