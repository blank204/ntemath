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
 * number without one.
 */

/** The id of the Lab section, so the Rail's last beat can hand off to it. */
export const LAB_ANCHOR = 'lab'

export interface Beat {
  id: string
  /**
   * The quantity this beat rests on, set in mono above the headline.
   *
   * It is the page's structural device and it carries information rather
   * than decorating: this is a chain of measurements, so each beat is
   * announced by the measurement it is about. Numbered markers (01 / 02)
   * would say only that beats come in an order, which the reader can see.
   */
  measure: string
  /** The small line above the headline. */
  kicker: string
  headline: string
  body: string
  /** Where the numbers in `body` come from. Required if `body` has any. */
  source?: string
  cta?: { label: string; href: string }
}

export const BEATS: Beat[] = [
  {
    id: 'flash',
    measure: '45% of fires / 81–93% of area',
    kicker: 'One flash',
    headline: 'Most of what burns was never lit by a person',
    body:
      'Lightning starts 45% of Canada\'s forest fires and is responsible for ' +
      '81–93% of the area they burn. The gap between those two numbers is the ' +
      'whole problem: lightning fires start where nobody is, so they are found ' +
      'late, and by then they are the ones that matter.',
    source:
      'Natural Resources Canada; the 81–93% range is the long-run average ' +
      'against intense seasons, reported as a range because it is one.',
  },
  {
    id: 'clock',
    measure: '>40 ms of continuing current',
    kicker: 'The strike, and the clock',
    headline: 'A strike does not become a fire on a schedule',
    body:
      'A stroke can smoulder in duff for minutes or for weeks before there is ' +
      'anything to see from the air. Across 152,375 recorded lightning fires ' +
      'the delay is gamma-distributed with a long tail — so "how long have we ' +
      'got" has a distribution for an answer, not a number. What decides ' +
      'whether fuel lights at all is continuing current: a stroke that keeps ' +
      'delivering charge for more than about 40 milliseconds, rather than the ' +
      'microsecond return stroke everyone pictures.',
    source:
      'Holdover distribution: 152,375 fires across 13 countries — a global ' +
      'dataset, not a Canadian one. The >40 ms continuing-current threshold is ' +
      'the attested mechanism; no current magnitude is quoted here because no ' +
      'primary source for one was found.',
  },
  {
    id: 'gap',
    measure: 'located to <1 km / scored: none',
    kicker: 'The gap',
    headline: 'Somebody knows where the lightning struck. Nobody knows which strike matters',
    body:
      'Electromagnetic networks already locate strokes continentally, to under ' +
      'a kilometre, and lightning-ignition models have been operational in ' +
      'Ontario for two decades. What no one ships is the last step: taking a ' +
      'strike, deciding whether it carried the current that lights fuel, and ' +
      'scoring it against the fuel and dryness of the ground it actually hit — ' +
      'as a ranked list of places to go and look.',
    source:
      'Wotton & Martell\'s model has run in Ontario and Saskatchewan for ~20 ' +
      'years and the US Forest Service publishes Potential Lightning Ignition ' +
      'maps. We claim the deployment, not the discovery.',
  },
  {
    id: 'tower',
    measure: '30 m mast / 5 subsystems',
    kicker: 'The tower',
    headline: 'A camera, a microphone array, and enough compute to decide',
    body:
      'Fixed infrastructure with power and backhaul, built to survive a Qatari ' +
      'August — 50 °C, dust, salt air — which is a harder brief than a boreal ' +
      'summer. The camera catches the flash. Three microphones give the ' +
      'bearing from the difference in arrival times. The gap between flash and ' +
      'thunder gives the range. On-tower compute turns those into a coordinate ' +
      'and a confidence — running off solar, because there is no grid this ' +
      'far from the road — and only the answer goes over the backhaul.',
    source:
      'Qatar-built, world-deployed: Qatar has no wildfire problem, it has the ' +
      'summers that qualify the hardware. Time-difference-of-arrival bearing ' +
      'and flash-to-bang ranging are standard acoustics; the tower is an ' +
      'engineering brief here, not a shipped product.',
  },
  {
    id: 'bang',
    measure: '340.4 m/s at 15 °C',
    kicker: 'Flash, then bang',
    headline: 'The oldest trick in storm-watching, done properly',
    body:
      'Light takes about 50 microseconds to cross 15 km. Sound takes the same ' +
      'distance at roughly a third of a kilometre per second, so the silence ' +
      'between them is the range — and the speed of sound is a function of air ' +
      'temperature, which is why the panel below lets you move it and shows ' +
      'what assuming the textbook value would cost you. This is a local ' +
      'confirmation layer and nothing more: audible thunder gives out near ' +
      '20 km, and terrain and temperature gradients open shadow zones well ' +
      'inside that.',
    source:
      'c = 331.3 + 0.606 T m/s. NLDN and GLD360 are sub-kilometre and ' +
      'range-unlimited; this does not compete with them, it stands under them.',
  },
  {
    id: 'two',
    measure: '43.7% → 54.6% triangulated',
    kicker: 'Two towers',
    headline: 'One tower gives you a fix. Two give you an intersection',
    body:
      'Range and bearing from a single station is already a position, and it ' +
      'is only as good as the angle that array resolved. Two towers turn it ' +
      'into a crossing. Measured on the shipped region: the 111-tower network ' +
      'sized to hear every strike once has 43.7% of its ground inside two ' +
      'towers, and re-choosing those same 111 towers for the two-tower rule ' +
      'raises that to 54.6% — while dropping single coverage from 95.1% to ' +
      '88.1%. It is a trade, and the Lab below lets you make it yourself.',
    source:
      'Same candidate pool, same tower count, one objective changed. Both ' +
      'columns are published because only one of them improved.',
  },
  {
    id: 'question',
    measure: '111 towers, 77,037 km²',
    kicker: 'The question',
    headline: 'So where do you put them?',
    body:
      'That is the part nobody publishes, and it is the part that decides ' +
      'whether any of the rest is affordable. Below is the model that answers ' +
      'it, running in this browser on baked NASA and ESA data, with a uniform ' +
      'grid as the baseline it has to beat — and the budgets where it does not.',
    cta: { label: 'Open the Lab', href: `#${LAB_ANCHOR}` },
  },
]
