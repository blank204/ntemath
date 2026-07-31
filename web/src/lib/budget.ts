/** Which rule decides how many nodes the run may place. */
export type BudgetMode = 'saturation' | 'auto' | 'fixed'

/** plan_region's saturation multipliers on the detection radius. */
const SAT_MIN = 0.55
const SAT_MAX = 1.3
/** plan_region's budgeted multipliers on the implied mean separation. */
const BUDGET_MIN = 0.45
const BUDGET_MAX = 1.1
/**
 * With a budget, plan_region sets an unreachable coverage target so that the
 * node cap is what binds: the objective flips from "fewest nodes for this
 * coverage" to "most risk watched with this many nodes".
 */
const UNREACHABLE_TARGET = 1.01

/**
 * `plan.auto_budget` rounds with the Python BUILTIN `round` (plan.py:172 —
 * `raw` is a plain float, so this is not np.round, though both use the same
 * rule). It is round-half-to-even; JavaScript's `Math.round` is half-up.
 * `auto_budget` rounds a quotient by 140, which lands exactly on a half often
 * enough to matter, so the difference is a whole node.
 *
 * `Math.round` breaks ties towards +Infinity, so on an exact half it always
 * returns the UPPER of the two neighbours — 1 for 0.5, and -1 for -1.5. The
 * even neighbour is therefore `r - 1` whenever `r` is odd, on both sides of
 * zero. (Subtracting `Math.sign(x)` instead would send -1.5 to 0.)
 */
export function roundHalfToEven(x: number): number {
  const r = Math.round(x)
  // Only exact halves differ between the two rules.
  if (Math.abs(x % 1) !== 0.5) return r
  return r % 2 === 0 ? r : r - 1
}

/**
 * A defensible node count when none is given. Port of `plan.auto_budget`.
 *
 * Scales with risk-weighted burnable area, then clamps. Note what this
 * actually produces: on Los Padres (5,074 km2 burnable, mean risk 0.506) it
 * returns 18 nodes — about 5% coverage on a region that needs ~572 for 95%.
 * The `hi` clamp is not even reached. The Lab offers this mode because it is
 * the library's own default and says plainly what it yields.
 */
export function autoBudget(
  areaKm2: number, meanRisk: number, km2PerNode: number,
  lo: number, hi: number,
): number {
  const m = meanRisk < 0 ? 0 : meanRisk > 1 ? 1 : meanRisk
  const raw = (areaKm2 * m) / km2PerNode
  const n = roundHalfToEven(raw)
  return Math.min(Math.max(n, lo), hi)
}

/**
 * Saturation spacing: `detect_km * 0.55` to `detect_km * 1.30`, from
 * plan_region. The pool must be DENSER than the answer, because the minimiser
 * can only delete, and discs of radius R tile the plane only at hexagonal
 * spacing R*sqrt(3) — a sparser pool leaves gaps no pruning can close.
 */
export function saturationSpacing(detectKm: number) {
  return { rMinKm: detectKm * SAT_MIN, rMaxKm: detectKm * SAT_MAX }
}

/**
 * Budgeted spacing, from plan_region: the pool is sized by the budget, not by
 * the detection radius. With a handful of nodes there is no overlap between
 * discs, so greedy has no diminishing-returns pressure to spread out and would
 * stack the whole budget in one hot valley; spacing the pool at roughly the
 * mean separation the budget implies forces geographic spread.
 */
export function budgetSpacing(burnKm2: number, nodes: number) {
  const spread = Math.sqrt(Math.max(burnKm2, 1) / Math.max(nodes, 1))
  return { rMinKm: spread * BUDGET_MIN, rMaxKm: spread * BUDGET_MAX }
}

export interface BudgetPlan {
  mode: BudgetMode
  /** null means saturation: place whatever the coverage target requires. */
  maxNodes: number | null
  greedyTarget: number
  rMinKm: number
  rMaxKm: number
  /** false when the reader overrode the spacing by hand. */
  derived: boolean
}

export function resolveBudget(args: {
  mode: BudgetMode
  fixedNodes: number
  detectKm: number
  target: number
  burnKm2: number
  meanRiskBurnable: number
  km2PerNode: number
  budgetLo: number
  budgetHi: number
  override: { rMinKm: number; rMaxKm: number } | null
}): BudgetPlan {
  let maxNodes: number | null = null
  let greedyTarget = args.target

  if (args.mode === 'auto') {
    maxNodes = autoBudget(args.burnKm2, args.meanRiskBurnable,
                          args.km2PerNode, args.budgetLo, args.budgetHi)
    greedyTarget = UNREACHABLE_TARGET
  } else if (args.mode === 'fixed') {
    if (!Number.isInteger(args.fixedNodes) || args.fixedNodes < 1) {
      throw new Error('a fixed budget needs at least 1 node')
    }
    maxNodes = args.fixedNodes
    greedyTarget = UNREACHABLE_TARGET
  }

  const spacing = args.override
    ? args.override
    : maxNodes === null
      ? saturationSpacing(args.detectKm)
      : budgetSpacing(args.burnKm2, maxNodes)

  return {
    mode: args.mode,
    maxNodes,
    greedyTarget,
    rMinKm: spacing.rMinKm,
    rMaxKm: spacing.rMaxKm,
    derived: args.override === null,
  }
}
