const ROWS = [0, 1, 2, 3];

export function LedgerSkeleton() {
  return (
    <div className="ledger-skeleton" aria-hidden="true">
      <div className="skeleton ledger-skeleton__hero" />
      <div className="ledger-skeleton__toolbar">
        <div className="skeleton ledger-skeleton__search" />
        <div className="skeleton ledger-skeleton__segments" />
      </div>
      <div className="ledger-skeleton__rows">
        {ROWS.map((row) => (
          <div key={row} className="ledger-skeleton__row">
            <div className="skeleton ledger-skeleton__glyph" />
            <div className="ledger-skeleton__copy">
              <div className="skeleton ledger-skeleton__line" />
              <div className="skeleton ledger-skeleton__line ledger-skeleton__line--short" />
            </div>
            <div className="skeleton ledger-skeleton__amount" />
          </div>
        ))}
      </div>
    </div>
  );
}
