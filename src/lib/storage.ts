function canUseLocalStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function canUseElectronStorage() {
  return typeof window !== 'undefined' && Boolean(window.electronAPI?.storage?.readJson)
}

function getElectronStorage() {
  return window.electronAPI?.storage ?? null
}

function readLegacyJsonStorage<T>(key: string, fallback: T): T {
  if (!canUseLocalStorage()) return fallback

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeLegacyJsonStorage(key: string, value: unknown) {
  if (!canUseLocalStorage()) return

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage write failures in constrained environments.
  }
}

function removeLegacyJsonStorage(key: string) {
  if (!canUseLocalStorage()) return

  try {
    window.localStorage.removeItem(key)
  } catch {
    // Ignore storage removal failures in constrained environments.
  }
}

export function readJsonStorage<T>(key: string, fallback: T): T {
  const electronStorage = canUseElectronStorage() ? getElectronStorage() : null
  if (electronStorage) {
    try {
      const value = electronStorage.readJson(key)
      if (value !== null && value !== undefined) {
        return value as T
      }
    } catch {
      // Fall back to the browser storage migration path below.
    }

    const legacy = readLegacyJsonStorage<T | null>(key, null)
    if (legacy !== null) {
      try {
        const ok = electronStorage.writeJson(key, legacy)
        if (ok) {
          removeLegacyJsonStorage(key)
        }
      } catch {
        // Keep the browser copy if the migration write fails.
      }
      return legacy as T
    }

    return fallback
  }

  return readLegacyJsonStorage(key, fallback)
}

export function writeJsonStorage(key: string, value: unknown) {
  const electronStorage = canUseElectronStorage() ? getElectronStorage() : null
  if (electronStorage) {
    try {
      const ok = electronStorage.writeJson(key, value)
      if (ok) {
        removeLegacyJsonStorage(key)
        return
      }
    } catch {
      // Fall back below.
    }
  }

  writeLegacyJsonStorage(key, value)
}

export function removeJsonStorage(key: string) {
  const electronStorage = canUseElectronStorage() ? getElectronStorage() : null
  if (electronStorage) {
    try {
      const ok = electronStorage.removeJson(key)
      if (ok) {
        removeLegacyJsonStorage(key)
        return
      }
    } catch {
      // Fall back below.
    }
  }

  removeLegacyJsonStorage(key)
}
