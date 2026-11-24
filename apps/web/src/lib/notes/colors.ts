import type { StudyNoteColor } from '@ats/shared';

/** Swatch colours (toolbar dots, note cards). Page highlight colours are in index.css (::highlight). */
export const NOTE_COLORS: { id: StudyNoteColor; label: string; swatch: string; bar: string }[] = [
  { id: 'yellow', label: 'Yellow', swatch: 'bg-yellow-300', bar: 'border-yellow-400' },
  { id: 'green', label: 'Green', swatch: 'bg-green-300', bar: 'border-green-500' },
  { id: 'blue', label: 'Blue', swatch: 'bg-sky-300', bar: 'border-sky-500' },
  { id: 'pink', label: 'Pink', swatch: 'bg-pink-300', bar: 'border-pink-500' },
];

export function noteBarClass(color: StudyNoteColor | null): string {
  return NOTE_COLORS.find((c) => c.id === color)?.bar ?? 'border-gray-300';
}
