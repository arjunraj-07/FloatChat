'use client';

/**
 * A glossary term with a static explanation on hover and keyboard focus.
 * Student view shows the plain-language text; scientific view the precise
 * definition. The data and calculations are identical in both.
 */

import type { ReactNode } from 'react';

import { GLOSSARY, type GlossaryTerm, type ViewMode } from '@/lib/explorerModel.ts';

interface Props {
  term: GlossaryTerm;
  mode: ViewMode;
  children: ReactNode;
}

export default function Term({ term, mode, children }: Props) {
  const text = GLOSSARY[term][mode];
  return (
    <span
      tabIndex={0}
      title={text}
      aria-label={`${typeof children === 'string' ? children : term}: ${text}`}
      className="cursor-help underline decoration-dotted decoration-slate-400 underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 rounded-sm"
    >
      {children}
    </span>
  );
}
