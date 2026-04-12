type SparklineProps = {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  strokeWidth?: number;
};

export function Sparkline({
  values,
  width = 120,
  height = 28,
  strokeWidth = 1.5,
  className = '',
}: SparklineProps) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const pad = 2;
  const h = height - pad * 2;
  const path = values
    .map((v, i) => {
      const x = i * step;
      const y = pad + h - ((v - min) / range) * h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
