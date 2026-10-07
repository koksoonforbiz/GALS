/**
 * Think-aloud validation codebook (plan Phase 5.1 #1): Bannert's SRL codes
 * plus the AI-interaction codes, each mapped to the Mapping-sheet rule(s)
 * whose trace output it validates. Researchers code think-aloud segments as
 * ReplayAnnotation ranges with these labels (ReplayCode is per researcher;
 * the seed endpoint creates the set for the calling researcher).
 *
 * Matching is by label, case-insensitive, so a researcher's own code set
 * works as long as the labels match.
 */
export interface CodebookEntry {
  label: string;
  color: string;
  rules: string[];
  group: 'Bannert SRL' | 'AI interaction' | 'Course' | 'Alignment';
}

export const VALIDATION_CODEBOOK: CodebookEntry[] = [
  { label: 'Orientation', color: '#2C5A8A', rules: ['M01'], group: 'Bannert SRL' },
  { label: 'Planning', color: '#3F7A57', rules: ['M02'], group: 'Bannert SRL' },
  { label: 'Goal specification', color: '#4F8A67', rules: ['M02'], group: 'Bannert SRL' },
  { label: 'Monitoring', color: '#B0741E', rules: ['M13'], group: 'Bannert SRL' },
  { label: 'Evaluation', color: '#A63D3D', rules: ['M14', 'M15'], group: 'Bannert SRL' },
  { label: 'First reading', color: '#5B6672', rules: ['M03'], group: 'Bannert SRL' },
  { label: 'Re-reading', color: '#6B7682', rules: ['M03b'], group: 'Bannert SRL' },
  { label: 'Elaboration/organisation', color: '#6B4C8A', rules: ['M04'], group: 'Bannert SRL' },
  { label: 'Forethought/prediction', color: '#8A6B2C', rules: ['M05'], group: 'Course' },
  { label: 'Belief revision', color: '#7A3F57', rules: ['M16'], group: 'Course' },
  { label: 'Self-appraisal', color: '#3F577A', rules: ['M22'], group: 'Course' },
  { label: 'Off-task', color: '#999999', rules: ['M25'], group: 'Course' },
  { label: 'Prompt planning', color: '#2C8A7A', rules: ['M26'], group: 'AI interaction' },
  {
    label: 'Evaluation-driven revision',
    color: '#2C7A5A',
    rules: ['M27'],
    group: 'AI interaction',
  },
  { label: 'Unreflective regeneration', color: '#C0504D', rules: ['M28'], group: 'AI interaction' },
  { label: 'Systematic testing', color: '#4D7AC0', rules: ['M29'], group: 'AI interaction' },
  { label: 'Verification', color: '#4DC07A', rules: ['M30'], group: 'AI interaction' },
  { label: 'Passive use', color: '#C08A4D', rules: ['M31'], group: 'AI interaction' },
  { label: 'Active use', color: '#7AC04D', rules: ['M32'], group: 'AI interaction' },
  { label: 'Executive request', color: '#C04D8A', rules: ['M33'], group: 'AI interaction' },
  {
    label: 'Instrumental request',
    color: '#8A4DC0',
    rules: ['M33', 'M08'],
    group: 'AI interaction',
  },
  // Not a process code: marks the think-aloud recording's start for alignment.
  { label: 'Think-aloud sync', color: '#000000', rules: [], group: 'Alignment' },
];

export function rulesForLabel(label: string): string[] {
  const e = VALIDATION_CODEBOOK.find((c) => c.label.toLowerCase() === label.trim().toLowerCase());
  return e?.rules ?? [];
}
