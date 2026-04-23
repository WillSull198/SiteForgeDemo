import { useEffect, useState } from "react";

function mergeWithDefaults(savedValue, defaultValue) {
  if (Array.isArray(defaultValue)) {
    return Array.isArray(savedValue) ? savedValue : defaultValue;
  }

  if (defaultValue && typeof defaultValue === "object") {
    const safeSaved = savedValue && typeof savedValue === "object" && !Array.isArray(savedValue) ? savedValue : {};
    const merged = { ...safeSaved };

    Object.keys(defaultValue).forEach((key) => {
      merged[key] = mergeWithDefaults(safeSaved[key], defaultValue[key]);
    });

    return merged;
  }

  return savedValue === undefined || savedValue === null ? defaultValue : savedValue;
}

export function usePersistentState(key, initialValue) {
  const [value, setValue] = useState(() => {
    const resolvedInitialValue = typeof initialValue === "function" ? initialValue() : initialValue;

    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          resolvedInitialValue &&
          typeof resolvedInitialValue === "object" &&
          "version" in resolvedInitialValue &&
          parsed &&
          typeof parsed === "object" &&
          parsed.version !== resolvedInitialValue.version
        ) {
          return resolvedInitialValue;
        }
        return mergeWithDefaults(parsed, resolvedInitialValue);
      }
    } catch (error) {
      console.warn(`Failed to load persisted state for ${key}`, error);
    }

    return resolvedInitialValue;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn(`Failed to persist state for ${key}`, error);
    }
  }, [key, value]);

  return [value, setValue];
}
