/**
 * Which beat the reader is in, and how far through it.
 *
 * Pure, and separated from the hook that feeds it, because scroll behaviour
 * is the kind of thing that is only ever tested by scrolling — which is to
 * say, not tested. Given the section geometry and a scroll position this is
 * ordinary arithmetic and can be checked at any position, including the ones
 * a person would never think to try.
 */

export interface SectionBox {
  /** Document-space offset of the section's top edge, px. */
  top: number
  height: number
}

export interface RailPosition {
  /** Index of the active beat, or -1 before the first layout pass. */
  index: number
  /**
   * Progress through that beat: 0 when the middle of the viewport is at the
   * beat's top edge, 1 at its bottom. A beat that opens the page therefore
   * starts near 0.5, because half of it is already above the fold.
   */
  t: number
}

export function railProgress(
  sections: SectionBox[], scrollY: number, viewportH: number,
): RailPosition {
  if (sections.length === 0) return { index: -1, t: 0 }

  // The active beat is the one under the MIDDLE of the viewport, because
  // each beat's text is vertically centred in its own section — so that is
  // the text being read. Anchoring on the top edge instead leaves the stage
  // a full beat behind: measured in a browser, beat two's words sat centred
  // on screen under beat one's picture.
  const y = Math.max(0, scrollY)
  const eye = y + viewportH / 2
  let index = 0
  for (let i = 0; i < sections.length; i++) {
    if (eye >= sections[i].top) index = i
    else break
  }

  const s = sections[index]
  const span = Math.max(1, s.height)
  const t = Math.min(1, Math.max(0, (eye - s.top) / span))
  // The last beat cannot be scrolled through — the page ends — so it would
  // otherwise sit at t = 0 forever and never finish its own animation.
  const last = index === sections.length - 1
  return { index, t: last && y + viewportH >= s.top + s.height ? 1 : t }
}
