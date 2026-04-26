import type { HTMLAttributes, ReactNode } from 'react';

type CardProps = HTMLAttributes<HTMLElement> & {
  title?: string;
  subtitle?: string;
  description?: string;
  children: ReactNode;
};

export function Card({
  title,
  subtitle,
  description,
  children,
  className = '',
  ...rest
}: CardProps) {
  return (
    <section
      className={`rounded-lg border border-border bg-card p-4 transition-colors ${className}`}
      {...rest}
    >
      {(title || subtitle || description) && (
        <header className="mb-3">
          {(title || subtitle) && (
            <div className="flex items-baseline justify-between gap-2">
              {title && (
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  {title}
                </h2>
              )}
              {subtitle && (
                <span className="text-[10px] text-text-muted">{subtitle}</span>
              )}
            </div>
          )}
          {description && (
            <p className="mt-0.5 text-[11px] leading-snug text-text-muted/60">
              {description}
            </p>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
