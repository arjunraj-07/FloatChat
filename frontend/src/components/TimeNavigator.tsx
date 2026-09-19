'use client';

/**
 * Time exploration for the latest result.
 *
 * Stepping through observation times is a deliberate activity, not something
 * everyone needs on screen, so the playback controls stay closed until
 * "Explore over time" is opened. Opening only reveals them: it never moves the
 * time, changes the selection or runs a query. Closing pauses playback so
 * nothing keeps moving out of sight.
 *
 * One thing is always visible when it matters: if the view is restricted to
 * an earlier time, a compact "Through …" indicator and "Show all times" stay
 * on screen whether the panel is open or closed, so a filtered result can
 * never look like a complete one.
 *
 * Presentation only: all state and timing live in `useTimeNavigator`.
 */

import { type NavigatorAction, type TimeStep, formatStepTime } from '@/lib/timeNavigator.ts';

interface Props {
  status: 'ready' | 'no_result' | 'no_data';
  steps: TimeStep[];
  index: number;
  playing: boolean;
  visibleCount: number;
  totalCount: number;
  untimedCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommand: (action: NavigatorAction, options?: { select?: boolean }) => void;
}

const BUTTON = 'button button-outline button-small shrink-0';

export default function TimeNavigator({
  status,
  steps,
  index,
  playing,
  visibleCount,
  totalCount,
  untimedCount,
  open,
  onOpenChange,
  onCommand,
}: Props) {
  if (status !== 'ready' || steps.length === 0) return null;

  const step = steps[index];
  const label = formatStepTime(step.instant);
  const single = steps.length < 2;
  const restricted = index < steps.length - 1;

  const toggle = () => {
    // Closing stops playback; opening changes nothing at all.
    if (open && playing) onCommand({ type: 'pause' });
    onOpenChange(!open);
  };

  const showAllTimes = () =>
    // Widens the view without changing which profile is open.
    onCommand({ type: 'go', index: steps.length - 1 }, { select: false });

  return (
    <div data-testid="time-bar" className="shrink-0 border-t border-[var(--divider)]">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <button
          type="button"
          data-testid="time-toggle"
          aria-expanded={open}
          aria-controls="time-navigator"
          onClick={toggle}
          className="button button-text button-small"
        >
          {open ? 'Hide time controls' : 'Explore over time'}
        </button>

        {restricted && (
          <>
            <span data-testid="time-through" className="chip chip-ochre">
              Through {label}
            </span>
            <button
              type="button"
              data-testid="time-show-all"
              onClick={showAllTimes}
              className="button button-text button-small"
            >
              Show all times
            </button>
          </>
        )}
      </div>

      {open && (
        <div
          id="time-navigator"
          data-testid="time-navigator"
          role="group"
          aria-label="Step through observation times in this result"
          // Extra bottom padding keeps the last line clear of the card's
          // rounded edge. It changes no behaviour and takes no height from
          // the chart, which sits in the panel beside this one.
          className="space-y-1.5 border-t border-[var(--divider)] bg-[var(--surface-quiet)] px-4 pb-4 pt-2.5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="time-prev"
              className={BUTTON}
              disabled={index === 0}
              onClick={() => onCommand({ type: 'step', delta: -1 })}
              aria-label="Previous observation time"
            >
              ‹
            </button>
            <button
              type="button"
              data-testid="time-play"
              className={`${BUTTON} w-[5.25rem]`}
              disabled={single}
              onClick={() => onCommand({ type: playing ? 'pause' : 'play' })}
              aria-label={playing ? 'Pause' : 'Play through observation times'}
              title={single ? 'Only one observation time in this result' : undefined}
            >
              {playing ? '❚❚ Pause' : '▶ Play'}
            </button>
            <button
              type="button"
              data-testid="time-next"
              className={BUTTON}
              disabled={index >= steps.length - 1}
              onClick={() => onCommand({ type: 'step', delta: 1 })}
              aria-label="Next observation time"
            >
              ›
            </button>
            <input
              type="range"
              data-testid="time-slider"
              aria-label="Observation time (UTC)"
              aria-valuetext={`${label}, step ${index + 1} of ${steps.length}`}
              min={0}
              max={steps.length - 1}
              step={1}
              value={index}
              disabled={single}
              onChange={(event) => onCommand({ type: 'go', index: Number(event.target.value) })}
              className="h-6 min-w-[6rem] flex-1 accent-[var(--teal)]"
            />
            <output data-testid="time-label" className="mono shrink-0 text-xs font-semibold tabular-nums text-[var(--ink)]">
              {label}
            </output>
          </div>
          <p data-testid="time-status" aria-live="polite" className="text-xs text-[var(--ink)]">
            Showing {visibleCount} of {totalCount} returned profiles through {label}.
          </p>
          <details className="tiny">
            <summary className="cursor-pointer select-none">About these steps</summary>
            <p className="mt-1">
              Step {index + 1} of {steps.length}
              {step.profileIds.length > 1 ? ` · ${step.profileIds.length} profiles at this time` : ''}. One step per
              observation time; the playback pace is not ocean time.
              {untimedCount > 0 &&
                ` ${untimedCount} returned profile(s) have no readable time and are not shown here.`}
            </p>
          </details>
        </div>
      )}
    </div>
  );
}
