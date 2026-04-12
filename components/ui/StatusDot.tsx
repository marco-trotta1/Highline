type StatusDotProps = {
  status: 'fresh' | 'stale' | 'no_data' | 'error';
  pulse?: boolean;
  size?: 'sm' | 'md';
};

export function StatusDot({ status, pulse = false, size = 'sm' }: StatusDotProps) {
  const color =
    status === 'fresh'
      ? 'bg-bull'
      : status === 'stale'
        ? 'bg-warn'
        : status === 'no_data'
          ? 'bg-text-muted'
          : 'bg-bear';
  const dim = size === 'md' ? 'h-2.5 w-2.5' : 'h-2 w-2';
  return (
    <span
      className={`inline-block rounded-full ${color} ${dim}`}
      data-pulse={pulse ? 'true' : 'false'}
      aria-label={status}
    />
  );
}
