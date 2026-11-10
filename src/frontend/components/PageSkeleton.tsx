export function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-label="正在加载页面" role="status">
      <div className="skeleton page-skeleton__title" />
      <div className="skeleton page-skeleton__hero" />
      <div className="page-skeleton__rows">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="page-skeleton__row" key={index}>
            <div className="skeleton page-skeleton__avatar" />
            <div className="page-skeleton__copy">
              <div className="skeleton page-skeleton__line" />
              <div className="skeleton page-skeleton__line page-skeleton__line--short" />
            </div>
            <div className="skeleton page-skeleton__amount" />
          </div>
        ))}
      </div>
    </div>
  );
}
