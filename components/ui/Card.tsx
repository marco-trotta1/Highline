import type { HTMLAttributes, ReactNode } from 'react';

type CardProps = HTMLAttributes<HTMLElement> & {
  title?: string;
  subtitle?: string;
  children: ReactNode;
};

export function Card({
  title,
  subtitle,
  children,
  className = '',
  ...rest
}: CardProps) {
  return (
    <section
      className={`rounded-lg border border-border bg-card p-4 transition-colors ${className}`}
      {...rest}
    >
      {(title || subtitle) && (
        <header className="mb-3 flex items-baseline justify-between gap-2">
          {title && (
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
              {title}
            </h2>
          )}
          {subtitle && (
            <span className="text-[10px] text-text-muted">{subtitle}</span>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
