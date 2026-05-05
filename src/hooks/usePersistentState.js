/* SiteForge audit: Upgraded persistence from localStorage-only to an IndexedDB
   primary store with localStorage fallback. This preserves existing browser demo
   state while allowing the v6 workflow data set to grow safely. */

import { useEffect, useRef, useState } from "react";
import { loadPersistedAppState, persistAppState } from "../services/dbService";

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
  const resolvedInitialValueRef = useRef(null);
  const persistTimerRef = useRef(null);
  const keyRef = useRef(key);
  const valueRef = useRef(null);
  const hydratedRef = useRef(false);
  if (resolvedInitialValueRef.current === null) {
    resolvedInitialValueRef.current = typeof initialValue === "function" ? initialValue() : initialValue;
  }

  const canUseIndexedDb =
    typeof window !== "undefined" &&
    typeof window.indexedDB !== "undefined";

  const [hydrated, setHydrated] = useState(false);
  const [value, setValue] = useState(() => {
    const resolvedInitialValue = resolvedInitialValueRef.current;

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

  valueRef.current = value;
  hydratedRef.current = hydrated;

  const persistNow = (targetKey = keyRef.current, targetValue = valueRef.current) => {
    if (!targetKey || targetValue === undefined || targetValue === null) return Promise.resolve();
    if (typeof window === "undefined") return Promise.resolve();
    try {
      window.localStorage.setItem(targetKey, JSON.stringify(targetValue));
    } catch (error) {
      console.warn(`Failed to mirror state for ${targetKey}`, error);
    }
    if (!canUseIndexedDb) return Promise.resolve();
    return persistAppState(targetKey, targetValue).catch((error) => {
      console.warn(`Failed to persist state for ${targetKey}`, error);
    });
  };

  useEffect(() => {
    let cancelled = false;
    const resolvedInitialValue = resolvedInitialValueRef.current;
    const previousKey = keyRef.current;

    if (previousKey !== key && hydratedRef.current) {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      persistNow(previousKey, valueRef.current);
      setHydrated(false);
    }
    keyRef.current = key;

    loadPersistedAppState(key)
      .then((saved) => {
        if (cancelled || !saved) return;
        if (
          resolvedInitialValue &&
          typeof resolvedInitialValue === "object" &&
          "version" in resolvedInitialValue &&
          saved &&
          typeof saved === "object" &&
          saved.version !== resolvedInitialValue.version
        ) {
          return;
        }
	        setValue(mergeWithDefaults(saved, resolvedInitialValue));
      })
      .catch(() => {
        // Safari private mode and locked-down browsers can reject IndexedDB.
        // The localStorage bootstrap above remains the fallback in that case.
      })
      .finally(() => {
        if (!cancelled) {
          setHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    if (persistTimerRef.current) {
      window.clearTimeout(persistTimerRef.current);
    }

    persistTimerRef.current = window.setTimeout(() => {
      if (canUseIndexedDb) {
        persistAppState(key, value)
          .then(() => {
            try {
              window.localStorage.setItem(key, JSON.stringify(value));
            } catch (error) {
              console.warn(`Failed to mirror state for ${key}`, error);
            }
          })
          .catch(() => {
            try {
              window.localStorage.setItem(key, JSON.stringify(value));
            } catch (error) {
              console.warn(`Failed to persist state for ${key}`, error);
            }
          });
        return;
      }

      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        console.warn(`Failed to persist state for ${key}`, error);
      }
    }, 350);

    return () => {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, [canUseIndexedDb, hydrated, key, value]);

  return [value, setValue, { hydrated, flushPendingWrites: () => persistNow(keyRef.current, valueRef.current) }];
}
