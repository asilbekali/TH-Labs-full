import { useEffect, useState } from 'react'

/** The key the user bound to "toggle-dubbing" in chrome://extensions/shortcuts, if any. */
export function useShortcut(): string | null {
  const [shortcut, setShortcut] = useState<string | null>(null)
  useEffect(() => {
    // chrome.commands only exists once the manifest that declares "commands" is loaded.
    chrome.commands
      ?.getAll()
      .then((all) => setShortcut(all.find((c) => c.name === 'toggle-dubbing')?.shortcut || null))
      .catch(() => {})
  }, [])
  return shortcut
}
