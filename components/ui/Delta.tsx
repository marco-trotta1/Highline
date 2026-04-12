import { formatSignedCurrency, formatSignedPct } from '@/lib/format';

type DeltaProps = {
  value: number | null | undefined;
  kind?: 'currency' | 'percent';
  decimals?: number;
  className?: string;
};

export function Delta({ value, kind = 'currency', decimals, className = '' }: DeltaProps) {
  if (value == null) {
    return <span className={`text-text-muted ${className}`}>—</span>;
  }
  const color =
    value > 0 ? 'text-bull' : value < 0 ? 'text-bear' : 'text-text-muted';
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '◆';
  const formatted =
    kind === 'currency'
      ? formatSignedCurrency(value, decimals ?? 2)
      : formatSignedPct(value, decimals ?? 2);
  return (
    <span className={`inline-flex items-baseline gap-1 font-mono ${color} ${className}`}>
      <span aria-hidden>{arrow}</span>
      <span>{formatted}</span>
    </span>
  );
}
