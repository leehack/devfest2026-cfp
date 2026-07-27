import { useId } from 'react';

/**
 * Hand-rolled SVG rather than a chart library.
 *
 * Three small charts do not justify 200kB of runtime on a page ten people open,
 * and the CSP on the deployed site blocks anything loaded from a CDN anyway.
 * Everything here is one `<svg>` and a scale function.
 *
 * Colours come from the same CSS variables as the rest of the app, so both
 * themes work without a second palette.
 */

export interface Slice {
  label: string;
  value: number;
}

const EMPTY = <p className="muted">—</p>;

/**
 * Horizontal bars. Chosen over vertical for category counts because the labels
 * are words, and words rotated 45° are a chart that has given up.
 */
export function BarChart({ data, max }: { data: Slice[]; max?: number }) {
  if (data.length === 0) return EMPTY;
  const ceiling = Math.max(max ?? 0, ...data.map((d) => d.value), 1);

  return (
    <ul className="chart chart--bars">
      {data.map((d) => (
        <li key={d.label}>
          <span className="chart__label">{d.label}</span>
          <span className="chart__track">
            <span className="chart__fill" style={{ width: `${(d.value / ceiling) * 100}%` }} />
          </span>
          <span className="chart__value">{d.value}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Score distribution, 1–4. A histogram rather than an average, because "3.0"
 * hides the difference between four reviewers who agree and two who did not.
 */
export function ScoreHistogram({ counts }: { counts: number[] }) {
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total === 0) return EMPTY;

  const ceiling = Math.max(...counts, 1);
  const width = 220;
  const height = 90;
  const gap = 8;
  const barWidth = (width - gap * (counts.length - 1)) / counts.length;

  return (
    <svg
      className="chart chart--histogram"
      viewBox={`0 0 ${width} ${height + 18}`}
      role="img"
      aria-label={counts.map((n, i) => `${i + 1}: ${n}`).join(', ')}
    >
      {counts.map((n, i) => {
        const barHeight = (n / ceiling) * height;
        const x = i * (barWidth + gap);
        return (
          <g key={i}>
            <rect
              x={x}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              rx="2"
              className="chart__bar"
            />
            <text x={x + barWidth / 2} y={height + 13} className="chart__tick">
              {i + 1}
            </text>
            {n > 0 && (
              <text x={x + barWidth / 2} y={height - barHeight - 3} className="chart__count">
                {n}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The decision funnel as one stacked bar. A pie would need a legend to read;
 * this one is labelled in place and stays legible at any width.
 */
export function StackedBar({ data }: { data: Slice[] }) {
  const id = useId();
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return EMPTY;

  return (
    <>
      <div className="chart chart--stack" role="img" aria-labelledby={id}>
        {data
          .filter((d) => d.value > 0)
          .map((d, i) => (
            <span
              key={d.label}
              className={`chart__segment chart__segment--${i % 4}`}
              style={{ width: `${(d.value / total) * 100}%` }}
              title={`${d.label}: ${d.value}`}
            />
          ))}
      </div>
      <ul id={id} className="chart__legend">
        {data
          .filter((d) => d.value > 0)
          .map((d, i) => (
            <li key={d.label}>
              <span className={`chart__key chart__key--${i % 4}`} />
              {d.label} <strong>{d.value}</strong>
            </li>
          ))}
      </ul>
    </>
  );
}
