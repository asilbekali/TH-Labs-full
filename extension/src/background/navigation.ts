// When the dubbed tab changes URL, should dubbing stop?
//
// chrome.tabs.onUpdated reports every URL change, including the ones a single-
// page app makes without reloading: YouTube's autoplay to the next video, a
// Meet lobby turning into the call, Twitch switching channels. Tab capture
// itself survives all of these; the question is what the user expects.

/**
 * @param from the URL the tab had when dubbing started
 * @param to   the URL it has now
 * @returns true to stop dubbing and release the tab
 */
export function shouldStopOnNavigation(from: string, to: string): boolean {
  // TODO(human): decide which URL changes end a dubbing session.
  void from
  void to
  return false
}
