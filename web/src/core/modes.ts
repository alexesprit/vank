import type { PracticeModeId } from '../../../shared/types.ts';
import wordsUrl from '../../data/words.json?url';
import type { SelectionStrategy } from './word-selector.ts';

export type { PracticeModeId } from '../../../shared/types.ts';

export interface PracticeModeDescriptor {
  id: PracticeModeId;
  url: string;
  strategy: SelectionStrategy;
  labelKey: string;
}

export const PRACTICE_MODES = [
  {
    id: 'words',
    url: wordsUrl,
    strategy: 'adaptive',
    labelKey: 'modes.words',
  },
] as const satisfies readonly PracticeModeDescriptor[];

export type PracticeMode = (typeof PRACTICE_MODES)[number];

export const DEFAULT_PRACTICE_MODE: PracticeModeId = 'words';

export function getPracticeMode(value: unknown): PracticeMode {
  const selected = PRACTICE_MODES.find((mode) => mode.id === value);
  return (
    selected ??
    PRACTICE_MODES.find((mode) => mode.id === DEFAULT_PRACTICE_MODE) ??
    PRACTICE_MODES[0]
  );
}
