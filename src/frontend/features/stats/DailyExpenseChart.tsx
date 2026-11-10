import { useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { formatMonthDay, weekdayLabel } from '@shared/date';
import { formatMoney } from '@shared/money';
import type { DailyTotal, MonthStats } from '@shared/types';
import { Icon } from '../../components/Icon';

interface DailyExpenseChartProps {
  stats: MonthStats;
}

function describeDay(day: DailyTotal): string {
  const parts = [`${formatMonthDay(day.date)} ${weekdayLabel(day.date)}`, `支出 ${formatMoney(day.expenseCents)}`];
  if (day.incomeCents > 0) parts.push(`收入 ${formatMoney(day.incomeCents)}`);
  parts.push(`${day.count} 笔`);
  return parts.join(' · ');
}

/** Keep date ticks sparse: first, last, and every fifth day when it will not collide with the last tick. */
function shouldShowTick(index: number, totalDays: number): boolean {
  const day = index + 1;
  if (day === 1 || day === totalDays) return true;
  return day % 5 === 0 && totalDays - day >= 2;
}

export function DailyExpenseChart({ stats }: DailyExpenseChartProps) {
  const days = stats.daily;
  const totalDays = days.length;
  const maxCents = days.reduce((max, day) => Math.max(max, day.expenseCents), 0);
  const peakIndex = stats.peakDay ? days.findIndex((day) => day.date === stats.peakDay?.date) : -1;
  const [tabStop, setTabStop] = useState(peakIndex >= 0 ? peakIndex : 0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const barRefs = useRef<Array<HTMLDivElement | null>>([]);

  const activeDay = activeIndex === null ? null : days[activeIndex] ?? null;
  const readout = activeDay
    ? `${formatMonthDay(activeDay.date)} · 支出 ${formatMoney(activeDay.expenseCents)}${
        activeDay.incomeCents > 0 ? ` · 收入 ${formatMoney(activeDay.incomeCents)}` : ''
      } · ${activeDay.count} 笔`
    : stats.peakDay
      ? `当月峰值 ${formatMonthDay(stats.peakDay.date)} · ${formatMoney(stats.peakDay.expenseCents)}`
      : '本月暂无支出记录';

  const focusDay = (index: number) => {
    if (totalDays === 0) return;
    const next = Math.max(0, Math.min(totalDays - 1, index));
    setTabStop(next);
    setActiveIndex(next);
    barRefs.current[next]?.focus();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, index: number) => {
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = index + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = totalDays - 1;
    if (next === null) return;
    event.preventDefault();
    focusDay(next);
  };

  return (
    <section className="stats-panel stats-chart" aria-labelledby="stats-chart-title">
      <div className="stats-chart__head">
        <div>
          <h2 className="stats-chart__title" id="stats-chart-title">
            每日支出
          </h2>
          <p className="stats-chart__sub">按当月最高单日归一化 · 覆盖 {stats.daysInMonth} 天</p>
        </div>
      </div>

      {maxCents > 0 ? (
        <>
          <p className={`stats-chart__readout${activeDay ? ' is-live' : ''}`}>
            <span className="stats-chart__readout-dot" aria-hidden="true" />
            <span className="stats-chart__readout-text">{readout}</span>
          </p>

          <div className="stats-chart__plot">
            <div className="stats-chart__grid" aria-hidden="true" />
            <div
              className="stats-chart__bars"
              style={{ '--days': String(totalDays) } as CSSProperties}
              role="group"
              aria-label="每日支出柱状图"
            >
              {days.map((day, index) => {
                const peak = index === peakIndex;
                const level = maxCents > 0 ? day.expenseCents / maxCents : 0;
                const label = `${peak ? '峰值 · ' : ''}${describeDay(day)}`;
                return (
                  <div
                    key={day.date}
                    ref={(node) => {
                      barRefs.current[index] = node;
                    }}
                    className={`stats-day${day.expenseCents > 0 ? ' has-expense' : ''}${peak ? ' is-peak' : ''}${
                      activeIndex === index ? ' is-active' : ''
                    }`}
                    style={{ '--level': String(level), '--i': String(index) } as CSSProperties}
                    role="img"
                    aria-label={label}
                    title={label}
                    tabIndex={tabStop === index ? 0 : -1}
                    onFocus={() => {
                      setTabStop(index);
                      setActiveIndex(index);
                    }}
                    onBlur={() => setActiveIndex(null)}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseLeave={() => setActiveIndex(null)}
                    onKeyDown={(event) => handleKeyDown(event, index)}
                  >
                    <span className="stats-day__track" aria-hidden="true">
                      <span className="stats-day__bar" />
                    </span>
                    <span className="stats-day__tick" aria-hidden="true">
                      {shouldShowTick(index, totalDays) ? index + 1 : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="stats-chart__legend">
            <span className="stats-chart__legend-item">
              <span className="stats-chart__legend-dot is-peak" aria-hidden="true" />
              峰值日
            </span>
            <span className="stats-chart__legend-item">
              <span className="stats-chart__legend-dot" aria-hidden="true" />
              每日支出
            </span>
            <span className="stats-chart__kbd">← → 逐日查看</span>
          </div>
        </>
      ) : (
        <div className="stats-chart__empty">
          <span className="stats-chart__empty-icon">
            <Icon name="chart" size={22} />
          </span>
          <p className="stats-chart__empty-title">本月还没有支出记录</p>
          <p className="stats-chart__empty-copy">有支出后，这里会按天呈现本月的消费节奏。</p>
        </div>
      )}
    </section>
  );
}
