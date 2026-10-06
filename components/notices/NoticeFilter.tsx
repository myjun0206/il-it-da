export interface NoticeFilterOption<Value extends string> {
  value: Value;
  label: string;
}

interface NoticeFilterProps<Value extends string> {
  ariaLabel: string;
  value: Value;
  options: readonly NoticeFilterOption<Value>[];
  onChange: (value: Value) => void;
  /** "chip": 직원 화면의 카테고리 칩 스타일(점주). 기본값은 기존 본사 스타일. */
  appearance?: "solid" | "chip";
}

export function NoticeFilter<Value extends string>({ ariaLabel, value, options, onChange, appearance = "solid" }: NoticeFilterProps<Value>) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(option.value)}
            className={appearance === "chip"
              ? `min-h-[36px] rounded-full border px-3.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                isSelected
                  ? "border-[var(--color-primary)] bg-[var(--color-primary-light)]/40 text-[var(--color-primary)]"
                  : "border-[var(--color-border)] bg-white text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-text-primary)]"
              }`
              : `inline-flex min-h-[44px] items-center justify-center rounded-lg border px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 ${
              isSelected
                ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                : "border-[var(--color-border)] bg-white text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}