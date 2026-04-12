'use client';

import { useState, type ReactNode } from 'react';

type CollapsiblePanelProps = {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

export function CollapsiblePanel({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: CollapsiblePanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-baseline gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
            {title}
          </span>
          {subtitle && (
            <span className="text-[10px] text-text-muted">{subtitle}</span>
          )}
        </span>
        <span className="text-text-muted" aria-hidden>
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-4 py-3">{children}</div>
      )}
    </section>
  );
}
