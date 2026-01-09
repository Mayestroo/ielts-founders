"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useSyncExternalStore,
} from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Get initial theme from localStorage (runs only on client)
function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return (localStorage.getItem("theme") as Theme) || "light";
}

// Get system preference
function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

// Subscribe function for useSyncExternalStore - no-op since we handle updates manually
const subscribe = () => () => {};

// Use useSyncExternalStore for hydration-safe mounting detection
function useIsMounted() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const mounted = useIsMounted();
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // Get current theme from localStorage
  const theme = mounted ? getStoredTheme() : "light";

  const resolvedTheme = useMemo<"light" | "dark">(() => {
    return theme === "system" ? getSystemTheme() : theme;
  }, [theme]);

  // Apply theme to document
  const applyTheme = useCallback((newTheme: "light" | "dark") => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(newTheme);
  }, []);

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme, applyTheme]);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      applyTheme(getSystemTheme());
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme, applyTheme]);

  // Set theme
  const setTheme = useCallback(
    (newTheme: Theme) => {
      localStorage.setItem("theme", newTheme);
      const resolved = newTheme === "system" ? getSystemTheme() : newTheme;
      applyTheme(resolved);
      forceUpdate();
    },
    [applyTheme]
  );

  // Toggle between light and dark
  const toggleTheme = useCallback(() => {
    const currentTheme = getStoredTheme();
    const currentResolved =
      currentTheme === "system" ? getSystemTheme() : currentTheme;
    const newTheme = currentResolved === "dark" ? "light" : "dark";
    setTheme(newTheme);
  }, [setTheme]);

  // Prevent flash of wrong theme
  if (!mounted) {
    return <div style={{ visibility: "hidden" }}>{children}</div>;
  }

  return (
    <ThemeContext.Provider
      value={{ theme, resolvedTheme, setTheme, toggleTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
