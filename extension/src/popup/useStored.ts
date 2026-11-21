import { useEffect, useState } from 'react'

type Area = 'local' | 'session'

/**
 * A chrome.storage value, kept in sync while the popup is open. `undefined`
 * means "not read yet", so the popup can avoid flashing the wrong screen.
 */
export function useStored<T>(area: Area, key: string): T | null | undefined {
  const [value, setValue] = useState<T | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    void chrome.storage[area].get(key).then((got) => {
      if (live) setValue((got[key] as T | undefined) ?? null)
    })
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, changed: string) => {
      if (changed === area && key in changes) setValue((changes[key].newValue as T | undefined) ?? null)
    }
    chrome.storage.onChanged.addListener(onChange)
    return () => {
      live = false
      chrome.storage.onChanged.removeListener(onChange)
    }
  }, [area, key])
  return value
}
