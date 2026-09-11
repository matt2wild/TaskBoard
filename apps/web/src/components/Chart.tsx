import { useEffect, useRef, useState } from 'react';

/** A small inline line chart. Enough for a weight trend or a lab series, and
 *  it costs nothing in bundle size. The width is measured so the plot fills
 *  its container rather than letterboxing inside a fixed viewBox. */
export function LineChart({ series, unit, refLow, refHigh, height = 130 }: {
  series: Array<{ x: string; y: number }>;
  unit?: string | null;
  refLow?: number | null;
  refHigh?: number | null;
  height?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)) || 560);
    return () => observer.disconnect();
  }, []);

  if (series.length < 2) {
    return (
      <div ref={box} className="w-full">
        <p className="dim text-sm py-6 text-center">Not enough readings to chart yet.</p>
      </div>
    );
  }
  const pad = { top: 10, right: 8, bottom: 20, left: 34 };
  const values = series.map((p) => p.y);
  const lo = Math.min(...values, refLow ?? Infinity);
  const hi = Math.max(...values, refHigh ?? -Infinity);
  const span = hi - lo || 1;
  const min = lo - span * 0.12;
  const max = hi + span * 0.12;

  const px = (i: number) => pad.left + (i / (series.length - 1)) * (width - pad.left - pad.right);
  const py = (v: number) => pad.top + (1 - (v - min) / (max - min)) * (height - pad.top - pad.bottom);

  const path = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ');
  const band = refLow != null && refHigh != null
    ? { y: py(refHigh), h: Math.max(py(refLow) - py(refHigh), 1) }
    : null;

  return (
    <div ref={box} className="w-full">
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img"
         aria-label={`Trend from ${series[0]!.y} to ${series.at(-1)!.y}${unit ? ` ${unit}` : ''}`}>
      {band && (
        <rect x={pad.left} y={band.y} width={width - pad.left - pad.right} height={band.h}
              fill="var(--accent)" opacity={0.1} />
      )}
      {[max, (max + min) / 2, min].map((v, i) => (
        <g key={i}>
          <line x1={pad.left} x2={width - pad.right} y1={py(v)} y2={py(v)}
                stroke="var(--border)" strokeWidth={1} />
          <text x={pad.left - 5} y={py(v) + 3} textAnchor="end" fontSize={9} fill="var(--text-dim)">
            {Math.round(v * 10) / 10}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round" />
      {series.map((p, i) => (
        <circle key={i} cx={px(i)} cy={py(p.y)} r={2.5} fill="var(--accent)">
          <title>{`${p.x}: ${p.y}${unit ? ` ${unit}` : ''}`}</title>
        </circle>
      ))}
      <text x={pad.left} y={height - 5} fontSize={9} fill="var(--text-dim)">{series[0]!.x.slice(0, 10)}</text>
      <text x={width - pad.right} y={height - 5} fontSize={9} fill="var(--text-dim)" textAnchor="end">
        {series.at(-1)!.x.slice(0, 10)}
      </text>
    </svg>
    </div>
  );
}
