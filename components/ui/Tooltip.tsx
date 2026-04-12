'use client';

import { useState, type ReactNode } from 'react';

type TooltipProps = {
  children: ReactNode;
  content: string;
  className?: string;
};

export function Tooltip({ children, content, className = '' }: TooltipProps) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        aria-label={content}
        aria-expanded={open}
        className="cursor-help outline-none focus-visible:ring-1 focus-visible:ring-accent rounded"
      >
        {children}
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-full z-20 mt-1 w-56 -translate-x-1/2 rounded-md border border-border bg-card px-2 py-1.5 text-xs leading-relaxed text-text shadow-lg"
        >
          {content}
        </span>
      )}
    </span>
  );
}
