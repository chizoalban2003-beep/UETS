import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem("driftworks-theme");
    if (stored) return stored === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
      localStorage.setItem("driftworks-theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("driftworks-theme", "light");
    }
  }, [dark]);

  // Apply on mount (before first render flash)
  useEffect(() => {
    const stored = localStorage.getItem("driftworks-theme");
    if (stored === "dark") document.documentElement.classList.add("dark");
    else if (stored === "light") document.documentElement.classList.remove("dark");
  }, []);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setDark((d) => !d)}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}
