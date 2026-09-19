/**
 * Workspace navigation.
 *
 * Pure functions over existing state, so they can be tested without a
 * browser. Choosing a section is display state only: it never edits the
 * query session, calls the model or runs a query.
 */

export type SectionId = 'map' | 'assistant' | 'compare' | 'about';

/**
 * Section ids are stable state; the labels are what people read. The ids keep
 * their original names so saved state, test ids and focus targets are
 * unaffected by renaming a label.
 */
export const SECTIONS: readonly { id: SectionId; label: string }[] = [
  { id: 'map', label: 'Explore' },
  { id: 'assistant', label: 'AI Assistant' },
  { id: 'compare', label: 'Compare' },
  { id: 'about', label: 'About' },
];

export const DEFAULT_SECTION: SectionId = 'map';

/** What Map Explorer's visualization area shows. The depth scene opens from the globe. */
export type MapView = 'regional' | 'globe' | 'depth';

/** Time playback runs only in Map Explorer. Leaving it pauses, keeping the selected time. */
export function pausesPlayback(from: SectionId, to: SectionId): boolean {
  return from === 'map' && to !== 'map';
}

/*
 * The assistant's five-stage workflow (ask → drafting → review → ready →
 * shown) lived here. The conversation replaced it: a thread has no stage, and
 * results now follow the filters rather than a "show results" step, so the
 * machine described a screen that no longer exists.
 */
