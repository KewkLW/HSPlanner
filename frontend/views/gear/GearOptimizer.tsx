import { useEffect, useMemo, useRef, useState } from 'react'
import { gameConfig, getItem, isGearSlot } from '@data'
import { useBuildPerformanceDeps } from '../../hooks/useBuildPerformanceDeps'
import { useBuild } from '../../store/build'
import {
  GEAR_OPTIMIZER_RARITIES,
  gearOptimizerThresholdId,
  meetsGearOptimizerThreshold,
  parseGearOptimizerThresholdId,
  type GearOptimizerRarity,
  type GearOptimizerRarityMode,
} from '../../types'
import {
  optimizeGearNative,
  type GearOptimizerResult,
} from '../../utils/calc/bridge'
import { compact } from '../../utils/compactNumber'
import {
  getAllocatedDamageSkills,
  resolveAllocatedDamageSkillId,
} from '../../utils/build/damageSkillTarget'
import {
  ATTRIBUTE_ORDER,
  DEFENSE_KEYS,
  OFFENSE_KEYS,
  RESISTANCES,
} from '../../utils/build/statSectionDefs'
import { statDef, statName } from '../../utils/item/stats'
import { RARITY_LABEL, RARITY_TEXT } from './lib/rarity'
import { isCleanEquippedItem } from './lib/itemEdits'

type OptimizerState =
  | { phase: 'idle' }
  | { phase: 'running'; current: number; total: number }
  | { phase: 'done'; result: GearOptimizerResult }
  | { phase: 'error'; message: string }

const SPECIAL_CATEGORIES = ['Relics', 'Charms', 'Potions'] as const
const RARITY_MODE_OPTIONS: ReadonlyArray<{
  value: GearOptimizerRarityMode
  label: string
}> = [
  { value: 'any', label: 'Any rarity' },
  { value: 'exact', label: 'Exactly' },
  { value: 'at_least', label: 'At least' },
  { value: 'at_most', label: 'At most' },
]

const THRESHOLD_ORDER = new Map(
  [
    ...ATTRIBUTE_ORDER.map((key) => gearOptimizerThresholdId('attribute', key)),
    ...OFFENSE_KEYS.map((key) => gearOptimizerThresholdId('stat', key)),
    ...DEFENSE_KEYS.map((key) => gearOptimizerThresholdId('stat', key)),
    ...RESISTANCES.map((entry) => gearOptimizerThresholdId('stat', entry.key)),
  ].map((id, index) => [id, index]),
)

interface ActiveThreshold {
  id: string
  label: string
  minimum: number
}

function formatThresholdNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const rounded = Number.isInteger(value)
    ? value
    : Math.round(value * 100) / 100
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function thresholdLabel(id: string): string {
  const parsed = parseGearOptimizerThresholdId(id)
  if (!parsed) return id
  if (parsed.kind === 'attribute') {
    return gameConfig.attributes.find((attribute) => attribute.key === parsed.statKey)?.name ?? statName(parsed.statKey)
  }
  return statName(parsed.statKey)
}

function formatThresholdValue(id: string, value: number): string {
  const parsed = parseGearOptimizerThresholdId(id)
  const suffix =
    parsed?.kind === 'stat' && statDef(parsed.statKey)?.format === 'percent'
      ? '%'
      : ''
  return `${formatThresholdNumber(value)}${suffix}`
}

function gainLabel(before: number, after: number): string {
  if (before <= 0) return after > 0 ? '+∞%' : '0%'
  const pct = (after / before - 1) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

export function GearOptimizer() {
  const deps = useBuildPerformanceDeps()
  const applyOptimizedGear = useBuild((s) => s.applyOptimizedGear)
  const thresholds = useBuild((s) => s.gearOptimizerThresholds)
  const setThreshold = useBuild((s) => s.setGearOptimizerThreshold)
  const clearThresholds = useBuild((s) => s.clearGearOptimizerThresholds)
  const rarityFilter = useBuild((s) => s.gearOptimizerRarityFilter)
  const setRarityFilter = useBuild((s) => s.setGearOptimizerRarityFilter)
  const [requestedSkillId, setRequestedSkillId] = useState('')
  const [state, setState] = useState<OptimizerState>({ phase: 'idle' })
  const epochRef = useRef(0)

  const activeThresholds = useMemo<ActiveThreshold[]>(
    () =>
      Object.entries(thresholds)
        .filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
        .map(([id, minimum]) => ({
          id,
          label: thresholdLabel(id),
          minimum,
        }))
        .toSorted((a, b) => {
          const aOrder = THRESHOLD_ORDER.get(a.id) ?? Number.MAX_SAFE_INTEGER
          const bOrder = THRESHOLD_ORDER.get(b.id) ?? Number.MAX_SAFE_INTEGER
          return aOrder - bOrder || a.label.localeCompare(b.label)
        }),
    [thresholds],
  )

  const eligibleSkills = useMemo(
    () => getAllocatedDamageSkills(deps),
    [deps],
  )
  const defaultSkillId = resolveAllocatedDamageSkillId(deps) ?? ''
  const selectedSkillId = eligibleSkills.some(
    (skill) => skill.id === requestedSkillId,
  )
    ? requestedSkillId
    : defaultSkillId

  useEffect(() => {
    epochRef.current += 1
    // A result belongs to one exact spec and selected spell.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((current) =>
      current.phase === 'running' ? current : { phase: 'idle' },
    )
  }, [deps, selectedSkillId, thresholds, rarityFilter])

  const start = async () => {
    if (!selectedSkillId || state.phase === 'running') return
    const epoch = epochRef.current
    setState({ phase: 'running', current: 0, total: 0 })
    try {
      const result = await optimizeGearNative(
        deps,
        selectedSkillId,
        {
          thresholds,
          rarityFilter: rarityFilter.mode === 'any' ? null : rarityFilter,
          onProgress: (current, total) => {
            if (epochRef.current === epoch) {
              setState({ phase: 'running', current, total })
            }
          },
        },
      )
      if (epochRef.current === epoch) setState({ phase: 'done', result })
    } catch (error) {
      if (epochRef.current !== epoch) return
      setState({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      // If the spec or constraints changed mid-search, keep the run locked until
      // its native worker settles, then discard the stale result.
      if (epochRef.current !== epoch) {
        setState((current) =>
          current.phase === 'running' ? { phase: 'idle' } : current,
        )
      }
    }
  }

  const changes = useMemo(() => {
    if (state.phase !== 'done') return []
    const rows: {
      slot: string
      currentName: string
      optimizedName: string
    }[] = []
    for (const slot of gameConfig.slots.filter((s) => isGearSlot(s.key))) {
      const currentId = deps.inventory[slot.key]?.baseId
      const optimizedId = state.result.baseIds[slot.key]
      const current = deps.inventory[slot.key]
      const sameCleanBase =
        currentId === optimizedId &&
        (current === undefined || isCleanEquippedItem(current))
      if (sameCleanBase) continue
      const sameConfiguredBase = currentId === optimizedId && current !== undefined
      const currentBaseName = currentId ? (getItem(currentId)?.name ?? currentId) : 'Empty'
      const optimizedBaseName = optimizedId
        ? (getItem(optimizedId)?.name ?? optimizedId)
        : 'Empty'
      rows.push({
        slot: slot.name,
        currentName: sameConfiguredBase
          ? `${currentBaseName} (configured)`
          : currentBaseName,
        optimizedName: sameConfiguredBase
          ? `${optimizedBaseName} (clean base)`
          : optimizedBaseName,
      })
    }
    return rows
  }, [deps.inventory, state])

  const thresholdResults = useMemo(() => {
    if (state.phase !== 'done') return []
    return activeThresholds.map((threshold) => {
      const actual = state.result.thresholdValues[threshold.id]
      return {
        ...threshold,
        actual,
        met:
          actual !== undefined &&
          meetsGearOptimizerThreshold(actual, threshold.minimum),
      }
    })
  }, [activeThresholds, state])

  const running = state.phase === 'running'
  const progressPct =
    running && state.total > 0
      ? Math.min(99, Math.round((state.current / state.total) * 100))
      : 0

  return (
    <section
      data-tour="gear-optimizer"
      className="mb-4 rounded-md border border-accent-deep/40 p-4"
      style={{
        background:
          'linear-gradient(180deg, rgba(58,46,24,0.28), color-mix(in srgb, var(--color-bg) 76%, transparent))',
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[240px] flex-1">
          <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-accent-hot">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rotate-45 bg-accent-hot"
            />
            Spell damage optimizer
          </div>
          <p className="max-w-3xl text-[12px] leading-relaxed text-muted">
            Scores every regular item base against one allocated spell, then
            searches full-set seeds, repeated slot sweeps, and paired swaps for
            the strongest loadout it can find.
          </p>
        </div>

        <button
          type="button"
          disabled={!selectedSkillId || running}
          onClick={() => void start()}
          className="rounded-[3px] border border-accent-deep px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-hot transition-all enabled:hover:border-accent-hot enabled:hover:shadow-[0_0_14px_rgba(224,184,100,0.25)] disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            background: 'linear-gradient(180deg, #3a2f1a, #2a2418)',
          }}
        >
          {running ? 'Optimizing…' : state.phase === 'done' ? 'Run again' : 'Optimize gear'}
        </button>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(210px,0.9fr)_minmax(280px,1.2fr)_2fr]">
        <label className="flex flex-col gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
          Spell
          <select
            aria-label="Spell to optimize"
            value={selectedSkillId}
            disabled={running || eligibleSkills.length === 0}
            onChange={(event) => setRequestedSkillId(event.target.value)}
            className="rounded-[3px] border border-border-2 bg-panel-2 px-2 py-2 font-mono text-[12px] normal-case tracking-normal text-text focus:border-accent-deep focus:outline-none disabled:opacity-40"
          >
            {eligibleSkills.length === 0 && <option value="">No allocated damage spell</option>}
            {eligibleSkills.map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.name} · rank {deps.skillRanks[skill.id]}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
            Regular-item rarity
          </legend>
          <div className="grid min-h-[34px] grid-cols-2 gap-2 rounded-[3px] border border-border-2 bg-black/15 p-2">
            <label className="flex flex-col gap-1 font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
              Rule
              <select
                aria-label="Rarity filter mode"
                value={rarityFilter.mode}
                disabled={running}
                onChange={(event) =>
                  setRarityFilter({
                    ...rarityFilter,
                    mode: event.target.value as GearOptimizerRarityMode,
                  })
                }
                className="rounded-[3px] border border-border-2 bg-panel-2 px-2 py-1.5 font-mono text-[11px] normal-case tracking-normal text-text focus:border-accent-deep focus:outline-none disabled:opacity-40"
              >
                {RARITY_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
              Tier
              <select
                aria-label="Rarity tier"
                value={rarityFilter.rarity}
                disabled={running || rarityFilter.mode === 'any'}
                onChange={(event) =>
                  setRarityFilter({
                    ...rarityFilter,
                    rarity: event.target.value as GearOptimizerRarity,
                  })
                }
                className={`rounded-[3px] border border-border-2 bg-panel-2 px-2 py-1.5 font-mono text-[11px] normal-case tracking-normal focus:border-accent-deep focus:outline-none disabled:opacity-40 ${RARITY_TEXT[rarityFilter.rarity]}`}
              >
                {GEAR_OPTIMIZER_RARITIES.map((rarity) => (
                  <option key={rarity} value={rarity}>
                    {RARITY_LABEL[rarity]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">
            Additional categories
          </legend>
          <div className="flex min-h-[34px] flex-wrap items-center gap-x-5 gap-y-2 rounded-[3px] border border-border-2 bg-black/15 px-3 py-2">
            {SPECIAL_CATEGORIES.map((category) => (
              <label
                key={category}
                className="flex cursor-not-allowed items-center gap-2 font-mono text-[10px] text-faint opacity-55"
              >
                <input
                  type="checkbox"
                  checked={false}
                  disabled
                  readOnly
                  aria-label={`Optimize ${category}`}
                />
                {category}
                <span className="uppercase tracking-[0.1em]">coming later</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <section className="mt-3" aria-labelledby="optimization-minimums-heading">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h3
            id="optimization-minimums-heading"
            className="font-mono text-[9px] uppercase tracking-[0.14em] text-faint"
          >
            Optional optimization minimums
          </h3>
          {activeThresholds.length > 0 && (
            <button
              type="button"
              disabled={running}
              onClick={clearThresholds}
              className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint transition-colors hover:text-stat-red disabled:opacity-40"
            >
              Clear all
            </button>
          )}
        </div>
        <div className="min-h-[38px] rounded-[3px] border border-border-2 bg-black/15 px-3 py-2">
          {activeThresholds.length === 0 ? (
            <p className="font-mono text-[10px] italic text-faint">
              None set — damage is maximized with no stat requirements. Use the +
              controls beside attributes and stats in the left panel to add one.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label="Active optimization minimums">
              {activeThresholds.map((threshold) => (
                <li
                  key={threshold.id}
                  className="inline-flex items-center gap-2 rounded-[3px] border border-accent-deep/50 bg-accent-hot/8 px-2 py-1 font-mono text-[10px] text-text"
                >
                  <span>
                    {threshold.label}{' '}
                    <span className="text-accent-hot">
                      ≥ {formatThresholdValue(threshold.id, threshold.minimum)}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={running}
                    aria-label={`Remove minimum ${threshold.label}`}
                    title={`Remove ${threshold.label} minimum`}
                    onClick={() => setThreshold(threshold.id, null)}
                    className="text-faint transition-colors hover:text-stat-red disabled:opacity-40"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {eligibleSkills.length === 0 && (
        <p className="mt-3 font-mono text-[11px] italic text-muted">
          Allocate a damaging active spell in the Spec tab first.
        </p>
      )}

      <p className="mt-3 font-mono text-[10px] leading-relaxed text-faint">
        V1 optimizes clean regular item bases and calculator-supported effects.
        Existing relics, charms, and potions remain fixed; affixes, forging,
        sockets, stars, augments, and display-only unique effects are not searched.
        Applying a result replaces regular slots with those clean bases, so those
        customizations are cleared. Satanic rarity rules include Satanic Set bases.
      </p>

      {running && (
        <div className="mt-4" aria-live="polite">
          <div className="mb-1 flex justify-between font-mono text-[10px] text-faint">
            <span>
              {state.total > 0
                ? `Evaluating ${state.current.toLocaleString()} / approximately ${state.total.toLocaleString()}`
                : 'Preparing candidate catalog…'}
            </span>
            {state.total > 0 && <span>{progressPct}%</span>}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full border border-border-2 bg-black/30">
            <div
              className="h-full bg-accent-hot transition-[width] duration-150"
              style={{ width: `${Math.max(2, progressPct)}%` }}
            />
          </div>
        </div>
      )}

      {state.phase === 'error' && (
        <p className="mt-4 font-mono text-[11px] text-stat-red" role="alert">
          Optimization failed: {state.message}
        </p>
      )}

      {state.phase === 'done' && (
        <div className="mt-4 border-t border-border-2 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                {state.result.thresholdsMet
                  ? 'Best loadout found'
                  : 'Closest loadout found'}{' '}
                · selected-spell DPS
              </div>
              <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
                <span className="text-[14px] text-muted">
                  {compact(state.result.beforeScore)}
                </span>
                <span className="text-faint">→</span>
                <span className="text-[18px] font-semibold text-accent-hot">
                  {compact(state.result.afterScore)}
                </span>
                <span
                  className={`text-[12px] ${
                    state.result.afterScore >= state.result.beforeScore
                      ? 'text-stat-green'
                      : 'text-stat-orange'
                  }`}
                >
                  {gainLabel(state.result.beforeScore, state.result.afterScore)}
                </span>
              </div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
                {state.result.evaluated.toLocaleString()} mathematical evaluations ·{' '}
                {state.result.passes} search passes · best-found, not an exhaustive proof
              </div>
            </div>
            <button
              type="button"
              disabled={changes.length === 0 || !state.result.thresholdsMet}
              title={
                state.result.thresholdsMet
                  ? 'Replace regular gear with the optimized clean item bases'
                  : 'This loadout does not meet every optimization minimum'
              }
              onClick={() => applyOptimizedGear(state.result.baseIds)}
              className="rounded-[3px] border border-accent-hot/60 bg-accent-hot/10 px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-hot transition-colors enabled:hover:border-accent-hot enabled:hover:bg-accent-hot/15 disabled:opacity-40"
            >
              Apply loadout
            </button>
          </div>

          {activeThresholds.length > 0 && (
            <div className="mt-3 rounded-[3px] border border-border-2 bg-black/15 p-3">
              {state.result.thresholdsMet ? (
                <p
                  className="font-mono text-[10px] uppercase tracking-[0.1em] text-stat-green"
                  role="status"
                >
                  All optimization minimums met
                </p>
              ) : (
                <p
                  className="font-mono text-[10px] leading-relaxed text-stat-red"
                  role="alert"
                >
                  No searched loadout met every minimum. This is the closest
                  combination found, and it cannot be applied as a valid result.
                </p>
              )}
              <ul
                className="mt-2 grid gap-1 md:grid-cols-2"
                aria-label="Optimization minimum results"
              >
                {thresholdResults.map((threshold) => (
                  <li
                    key={threshold.id}
                    className="flex items-center justify-between gap-3 rounded-[3px] border border-border-2 px-2.5 py-1.5 font-mono text-[10px]"
                  >
                    <span className="min-w-0 truncate text-muted">
                      {threshold.label}{' '}
                      <span className="text-faint">
                        ≥ {formatThresholdValue(threshold.id, threshold.minimum)}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 tabular-nums ${
                        threshold.met ? 'text-stat-green' : 'text-stat-red'
                      }`}
                    >
                      {threshold.actual === undefined
                        ? '—'
                        : formatThresholdValue(threshold.id, threshold.actual)}{' '}
                      <span className="sr-only">
                        {threshold.met ? 'met' : 'not met'}
                      </span>
                      <span aria-hidden>{threshold.met ? '✓' : '✕'}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {changes.length === 0 ? (
            <p className="mt-3 font-mono text-[11px] italic text-muted">
              {state.result.thresholdsMet
                ? 'Your regular item bases already match the best loadout found.'
                : 'No regular-item change produced a valid threshold-constrained loadout.'}
            </p>
          ) : (
            <ul className="mt-3 grid gap-1 md:grid-cols-2">
              {changes.map((change) => (
                <li
                  key={change.slot}
                  className="flex min-w-0 items-center gap-2 rounded-[3px] border border-border-2 bg-black/15 px-3 py-2 text-[11px]"
                >
                  <span className="w-20 shrink-0 font-mono uppercase tracking-[0.1em] text-faint">
                    {change.slot}
                  </span>
                  <span className="min-w-0 truncate text-muted">
                    {change.currentName}
                  </span>
                  <span className="text-faint">→</span>
                  <span className="min-w-0 truncate text-accent-hot">
                    {change.optimizedName}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
