"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  ReactNode,
} from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);
  const isInitializedRef = useRef(false);

  // Determine resolved theme helper
  const determineResolvedTheme = (t: Theme): "light" | "dark" => {
    if (t === "system") {
      return typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return t;
  };

  // Initialize theme from localStorage and system preference
  // Use layoutEffect to apply before React renders
  useLayoutEffect(() => {
    if (isInitializedRef.current) return;

    // Get saved theme from localStorage
    const savedTheme = localStorage.getItem("ilitda-theme") as Theme | null;
    const initialTheme = savedTheme || "system";
    const initial = determineResolvedTheme(initialTheme);

    // Apply theme to HTML - this must happen before paint
    const htmlElement = document.documentElement;
    htmlElement.classList.remove("light", "dark");
    htmlElement.classList.add(initial);

    isInitializedRef.current = true;
  }, []);

  // Use effect to update state only after layout effect has applied theme
  useEffect(() => {
    if (!isInitializedRef.current) return;

    const savedTheme = localStorage.getItem("ilitda-theme") as Theme | null;
    const initialTheme = savedTheme || "system";
    const initial = determineResolvedTheme(initialTheme);

    setThemeState(initialTheme);
    setResolvedTheme(initial);
    setMounted(true);
  }, []);

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (theme !== "system" || !mounted) return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (e: MediaQueryListEvent) => {
      const newResolved = e.matches ? "dark" : "light";
      setResolvedTheme(newResolved);

      const htmlElement = document.documentElement;
      htmlElement.classList.remove("light", "dark");
      htmlElement.classList.add(newResolved);
    };

    // Use addEventListener if available, otherwise use addListener (older API)
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    } else {
      // Fallback for older browsers
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [theme, mounted]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem("ilitda-theme", newTheme);

    // Determine and apply resolved theme
    const determined = determineResolvedTheme(newTheme);
    setResolvedTheme(determined);

    // Apply to HTML
    const htmlElement = document.documentElement;
    htmlElement.classList.remove("light", "dark");
    htmlElement.classList.add(determined);
  };

  // Don't render children until mounted to prevent hydration mismatch
  if (!mounted) {
    return null;
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
