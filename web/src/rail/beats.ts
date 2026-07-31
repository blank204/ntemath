/**
 * The Rail: seven beats, as data.
 *
 * Copy lives here rather than inside JSX so the science constraints in
 * `docs/superpowers/specs/2026-07-31-pyra-lightning-pivot.md` §2 can be
 * enforced over it by tests, exactly as they are over the Lab's copy. Three of
 * those claims were asserted in a draft, disproved by research the same day,
 * and came within one editing pass of a competition video.
 *
 * EVERY NUMBER CARRIES ITS SOURCE. A figure a judge cannot check is a figure
 * this project has no business showing, and a test fails a beat that states a
 * number without one. That now includes `figure` itself, which is the largest
 * number on the page and therefore the one most worth checking.
 *
 * THE SHAPE, AND WHY IT IS THIS SHORT. Each beat is one headline, one figure,
 * and at most 25 words — a ceiling with a test behind it. The bodies used to
 * run 60–90 words and the page read as documentation nobody wanted to look at.
 * The research did not disappear: `source` still travels with every beat and
 * is rendered in end matter, where a judge who wants it will look and where it
 * has stopped competing with the thing it supports.
 */

/** The id of the Lab section, so the Rail's last beat can hand off to it. */
export const LAB_ANCHOR = 'lab'

/** The end-matter section, where every beat's sourcing is rendered in full. */
export const SOURCES_ANCHOR = 'sources'

/** The ceiling on a beat body, enforced in beats.test.ts. */
export const BODY_WORD_CEILING = 25

export interface Beat {
  id: string
  /**
   * The quantity this beat rests on, set at `SIZE.figure` in the display face.
   *
   * It is the page's structural device and it carries information rather than
   * decorating: this is a chain of measurements, so each beat is announced by
   * the measurement it is about. Numbered markers (01 / 02) would say only
   * that beats come in an order, which the reader can already see.
   */
  figure: string
  /**
   * What the figure measures. Required, and not decorative — a bare number at
   * 148px with no unit is the most confident way this page could lie.
   */
  figureNote: string
  /** The small line above the figure. */
  eyebrow: string
  /** Pinned on the left, set large enough that the split cuts it in half. */
  headline: string
  /** At most BODY_WORD_CEILING words. Three lines on screen. */
  body: string
  /** Where the numbers in `body` and `figure` come from. Required if any. */
  source?: string
  cta?: { label: string; href: string }
}

export const BEATS: Beat[] = [
  {
    id: 'flash',
    figure: '81–93%',
    figureNote: 'of the area Canada\'s forest fires burn',
    eyebrow: 'One flash',
    headline: 'Most of what burns was never lit by a person',
    body:
      'Lightning starts 45% of them. They start where nobody is, so they are ' +
      'found late — and by then they are the ones that matter.',
    source:
      'Natural Resources Canada. Lightning starts 45% of Canada\'s forest ' +
      'fires and is responsible for 81–93% of the area they burn; the range ' +
      'is the long-run average against intense seasons, reported as a range ' +
      'because it is one.',
  },
  {
    id: 'clock',
    figure: '>40 ms',
    figureNote: 'of continuing current, or the fuel never lights',
    eyebrow: 'The strike, and the clock',
    headline: 'A strike does not become a fire on a schedule',
    body:
      'A stroke can smoulder in duff for minutes or for weeks. The delay has ' +
      'a distribution for an answer, not a number.',
    source:
      'Holdover distribution: 152,375 fires across 13 countries — a global ' +
      'dataset, not a Canadian one — gamma-distributed with a long tail. What ' +
      'decides whether fuel lights at all is continuing current: a stroke that ' +
      'keeps delivering charge for more than about 40 milliseconds, rather ' +
      'than the microsecond return stroke everyone pictures. No current ' +
      'magnitude is quoted because no primary source for one was found.',
  },
  {
    id: 'gap',
    figure: '<1 km',
    figureNote: 'located, continentally. Scored against the ground: nowhere',
    eyebrow: 'The gap',
    headline: 'Somebody knows where the lightning struck. Nobody knows which strike matters',
    body:
      'Networks already locate every stroke. Nobody ranks them by whether the ' +
      'ground they hit is dry enough to carry a fire.',
    source:
      'Electromagnetic networks locate strokes continentally to under a ' +
      'kilometre (<1 km). Wotton & Martell\'s ignition model has run in ' +
      'Ontario and ' +
      'Saskatchewan for ~20 years and the US Forest Service publishes ' +
      'Potential Lightning Ignition maps. We claim the deployment, not the ' +
      'discovery.',
  },
  {
    id: 'tower',
    figure: '30 m',
    figureNote: 'of mast: camera, microphone array, compute, solar, backhaul',
    eyebrow: 'The tower',
    headline: 'A camera, a microphone array, and enough compute to decide',
    body:
      'The camera catches the flash. Three microphones give the bearing. The ' +
      'silence between them gives the range.',
    source:
      'Qatar-built, world-deployed: Qatar has no wildfire problem, it has the ' +
      'summers that qualify the hardware — 50 °C, dust, salt air, a harder ' +
      'brief than a boreal summer. Time-difference-of-arrival bearing and ' +
      'flash-to-bang ranging are standard acoustics. Part by part: the camera ' +
      'head sees the flash, which starts every measurement; the microphone ' +
      'array is three booms, giving bearing from time-difference-of-arrival; ' +
      'compute scores the strike on the tower, so only the answer leaves; ' +
      'solar, because there is no grid this far north of the road; backhaul ' +
      'carries a coordinate and a confidence, not a video feed. The tower is ' +
      'an engineering brief here, not a shipped product.',
  },
  {
    id: 'bang',
    figure: '340.4 m/s',
    figureNote: 'the speed of sound at 15 °C — and it moves with the air',
    eyebrow: 'Flash, then bang',
    headline: 'The oldest trick in storm-watching, done properly',
    body:
      'The silence between flash and thunder is the range. A local ' +
      'confirmation layer, nothing more: audible thunder gives out near 20 km.',
    source:
      'c = 331.3 + 0.606 T m/s, which gives 340.4 m/s at 15 °C and is why ' +
      'the panel lets you move the temperature and shows what assuming the ' +
      'textbook value would cost. ' +
      'Terrain and temperature gradients open shadow zones well inside 20 km. ' +
      'NLDN and GLD360 are sub-kilometre and range-unlimited; this does not ' +
      'compete with them, it stands under them.',
  },
  {
    id: 'two',
    figure: '54.6%',
    figureNote: 'triangulated, up from 43.7% — and it is a trade, not a win',
    eyebrow: 'Two towers',
    headline: 'One tower gives you a fix. Two give you an intersection',
    body:
      'Re-choosing the same 111 towers for the two-tower rule raises ' +
      'triangulation from 43.7% to 54.6%, and drops single coverage from ' +
      '95.1% to 88.1%.',
    source:
      'Measured on the shipped region at the shipped defaults: 43.7% → 54.6% ' +
      'triangulated, 95.1% → 88.1% single. Same candidate pool, same tower ' +
      'count, one objective changed. Both columns are published because only ' +
      'one of them improved, and the Lab below lets you make the trade ' +
      'yourself.',
  },
  {
    id: 'question',
    figure: '111',
    figureNote: 'towers over 77,037 km², and the argument about where they go',
    eyebrow: 'The question',
    headline: 'So where do you put them?',
    body:
      'The model runs below, in this browser, on baked NASA and ESA data — ' +
      'against a uniform grid it does not always beat.',
    source:
      'Saturation to the 95% coverage target takes 111 towers over the ' +
      '77,037 km² James Bay box and reaches 95.1% risk-weighted coverage. The ' +
      'uniform grid takes the lead at 88 towers on single coverage, which is ' +
      'why both curves are on screen.',
    cta: { label: 'Open the Lab', href: `#${LAB_ANCHOR}` },
  },
]
