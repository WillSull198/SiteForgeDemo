/* SiteForge audit: Upgraded persistence from localStorage-only to an IndexedDB
   primary store with localStorage fallback. This preserves existing browser demo
   state while allowing the v6 workflow data set to grow safely. */

import { useEffect, useRef, useState } from "react";
import { loadPersistedAppState, persistAppState } from "../services/dbService";

const LOCAL_STORAGE_SAFE_LIMIT = 4_000_000;

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
  const degradedRef = useRef(false);
  if (resolvedInitialValueRef.current === null) {
    resolvedInitialValueRef.current = typeof initialValue === "function" ? initialValue() : initialValue;
  }

  const canUseIndexedDb =
    typeof window !== "undefined" &&
    typeof window.indexedDB !== "undefined";

  const [hydrated, setHydrated] = useState(false);
  const [lastPersistedAt, setLastPersistedAt] = useState(null);
  const [persistenceDegraded, setPersistenceDegraded] = useState(false);
  const [value, setValue] = useState(() => {
    const resolvedInitialValue = resolvedInitialValueRef.current;

    try {
      if (typeof window === "undefined" || !key) return resolvedInitialValue;
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

  const markPersistenceDegraded = (message) => {
    console.warn(message);
    setPersistenceDegraded(true);
    if (degradedRef.current) return;
    degradedRef.current = true;
    setValue((current) => {
      if (!current || typeof current !== "object" || Array.isArray(current) || current.persistenceDegraded) return current;
      return {
        ...current,
        persistenceDegraded: true,
        persistenceWarning: message,
      };
    });
  };

  const persistToLocalStorageFallback = (targetKey, targetValue) => {
    try {
      const serialized = JSON.stringify(targetValue);
      if (serialized.length > LOCAL_STORAGE_SAFE_LIMIT) {
        markPersistenceDegraded(
          `[SiteForge] Persistence degraded: state is ${serialized.length.toLocaleString()} bytes, above the localStorage safety limit. IndexedDB is unavailable, so this browser cannot safely save the current project.`,
        );
        return Promise.resolve({ degraded: true });
      }
      window.localStorage.setItem(targetKey, serialized);
      const savedAt = new Date().toISOString();
      setLastPersistedAt(savedAt);
      setPersistenceDegraded(false);
      return Promise.resolve({ updatedAt: savedAt });
    } catch (error) {
      markPersistenceDegraded(`[SiteForge] Persistence degraded: localStorage save failed for ${targetKey}. ${error?.message || ""}`.trim());
      return Promise.resolve({ degraded: true });
    }
  };

  const persistNow = (targetKey = keyRef.current, targetValue = valueRef.current) => {
    if (!targetKey || targetValue === undefined || targetValue === null) return Promise.resolve();
    if (typeof window === "undefined") return Promise.resolve();
    if (!canUseIndexedDb) return persistToLocalStorageFallback(targetKey, targetValue);
    return persistAppState(targetKey, targetValue)
      .then((result) => {
        if (result?.updatedAt) {
          setLastPersistedAt(result.updatedAt);
        }
        setPersistenceDegraded(false);
        return result;
      })
      .catch((error) => {
        markPersistenceDegraded(`[SiteForge] Persistence degraded: IndexedDB save failed for ${targetKey}. ${error?.message || ""}`.trim());
        return { degraded: true };
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

    if (!key || !canUseIndexedDb) {
      setHydrated(true);
      return () => {
        cancelled = true;
      };
    }

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
  }, [canUseIndexedDb, key]);

  useEffect(() => {
    if (!hydrated) return;
    if (persistTimerRef.current) {
      window.clearTimeout(persistTimerRef.current);
    }

    persistTimerRef.current = window.setTimeout(() => {
      persistNow(key, value);
    }, 350);

    return () => {
      if (persistTimerRef.current) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, [canUseIndexedDb, hydrated, key, value]);

  return [
    value,
    setValue,
    {
      hydrated,
      flushPendingWrites: () => persistNow(keyRef.current, valueRef.current),
      lastPersistedAt,
      persistenceDegraded,
    },
  ];
}
