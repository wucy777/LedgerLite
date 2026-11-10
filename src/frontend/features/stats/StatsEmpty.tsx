import type { CSSProperties } from 'react';
import { monthLabel } from '@shared/date';
import { Icon } from '../../components/Icon';

interface StatsEmptyProps {
  month: string;
}

const DECORATIVE_BARS = [26, 42, 34, 58, 46, 72, 38];

export function StatsEmpty({ month }: StatsEmptyProps) {
  return (
    <section className="stats-empty" aria-label={`${monthLabel(month)}暂无统计数据`}>
      <div className="stats-empty__spark" aria-hidden="true">
        {DECORATIVE_BARS.map((height, index) => (
          <span
            key={index}
            className={`stats-empty__bar${index === 5 ? ' is-peak' : ''}`}
            style={{ '--h': `${height}%`, '--i': String(index) } as CSSProperties}
          />
        ))}
      </div>
      <p className="stats-empty__eyebrow">{monthLabel(month)}</p>
      <h2 className="stats-empty__title">这个月还没有记账</h2>
      <p className="stats-empty__copy">记下第一笔收支后，这里会自动生成每日走势、关键指标和分类构成。</p>
      <p className="stats-empty__hint">
        <Icon name="sparkle" size={14} />
        从「明细」页开始记录
      </p>
    </section>
  );
}
