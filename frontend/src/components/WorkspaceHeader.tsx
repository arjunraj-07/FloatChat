'use client';

/**
 * The heading block each workspace opens with: a small eyebrow, the title,
 * one line of orientation, and optional status on the right.
 */

import type { ReactNode } from 'react';

interface Props {
  eyebrow: string;
  title: string;
  description: string;
  headingId: string;
  children?: ReactNode;
}

export default function WorkspaceHeader({ eyebrow, title, description, headingId, children }: Props) {
  return (
    <div className="workspace-header mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="section-label">{eyebrow}</p>
        <h1 id={headingId} tabIndex={-1} className="focus:outline-none">
          {title}
        </h1>
        <p>{description}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}
