const LOADOUT_SLOT_COUNT = 8;

export interface AllocationLoadoutBarProps {
  label: string;
  slots: readonly (unknown | null)[];
  activeIndex: number;
  onCreate: (index: number) => void;
  onSelect: (index: number) => void;
}
export default function AllocationLoadoutBar({
  label,
  slots,
  activeIndex,
  onCreate,
  onSelect,
}: AllocationLoadoutBarProps) {
  return (
    <div
      className="flex h-10 shrink-0 items-center justify-between gap-4 border-b border-border px-4"
      style={{
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--color-panel-2) 82%, #000), var(--color-panel))",
        boxShadow:
          "inset 0 -1px 0 rgba(201,165,90,0.05), 0 1px 0 rgba(0,0,0,0.35)",
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 shrink-0 rotate-45 bg-accent-deep"
        />
        <span className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
          {label} loadouts
        </span>
      </div>

      <div
        role="group"
        aria-label={`${label} loadouts`}
        className="flex shrink-0 items-center gap-1.5"
      >
        {Array.from({ length: LOADOUT_SLOT_COUNT }, (_, index) => {
          const occupied = slots[index] != null;
          const number = index + 1;
          const active = occupied && activeIndex === index;
          const accessibleLabel = occupied
            ? `Select ${label} loadout ${number}`
            : `Create ${label} loadout ${number}`;

          return (
            <button
              key={`${label}-${index}`}
              type="button"
              aria-label={accessibleLabel}
              aria-pressed={occupied ? active : undefined}
              title={accessibleLabel}
              onClick={() => (occupied ? onSelect(index) : onCreate(index))}
              className={`grid h-8 w-8 place-items-center rounded-[2px] border font-mono tabular-nums transition-all focus-visible:outline-offset-2 ${
                active
                  ? "border-accent-hot bg-[#2a2418] text-[13px] font-semibold text-accent-hot shadow-[inset_0_0_0_1px_rgba(224,184,100,0.3),0_0_10px_rgba(224,184,100,0.22)]"
                  : occupied
                    ? "border-border-2 bg-bg/80 text-[12px] font-medium text-muted hover:border-accent-deep hover:text-accent-hot"
                    : "border-border-2 bg-bg/80 text-[18px] font-semibold leading-none text-accent-hot hover:border-accent-deep hover:bg-accent-hot/5 hover:text-[#fff0c4]"
              }`}
            >
              <span aria-hidden>{occupied ? number : "+"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
