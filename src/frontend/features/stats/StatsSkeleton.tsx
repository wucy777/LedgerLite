export function StatsSkeleton() {
  return (
    <div className="stats-skeleton" role="status" aria-label="正在加载统计数据">
      <div className="stats-skeleton__overview">
        <div className="skeleton stats-skeleton__hero" />
        <div className="stats-skeleton__kpis">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="skeleton stats-skeleton__kpi" />
          ))}
        </div>
      </div>
      <div className="stats-skeleton__main">
        <div className="skeleton stats-skeleton__chart" />
        <div className="skeleton stats-skeleton__categories" />
      </div>
    </div>
  );
}
