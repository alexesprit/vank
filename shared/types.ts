export interface PronunciationUnit {
  source: string;
  latin: string;
  cyrillic: string;
}
export interface SourceInfo {
  type: string;
  url?: string;
  license?: string;
  name?: string;
}
export interface Word {
  id: string;
  word: string;
  readingLatin: string;
  acceptedLatin: string[];
  acceptedCyrillic: string[];
  letters: string[];
  uniqueLetters: string[];
  length: number;
  units?: PronunciationUnit[];
  meaning?: Record<string, string>;
  familiarity?: Record<string, number>;
  frequencyScore?: number;
  loanwordScore?: number;
  visualDifficulty?: number;
  readingDifficulty?: number;
  usefulnessScore?: number;
  categories: string[];
  tags: string[];
  source?: SourceInfo;
  transliterationVersion?: number;
}
export interface Dictionary {
  version: number;
  schemaVersion: number;
  generatedAt: string;
  words: Word[];
}
export interface LetterStat {
  score: number;
  attempts: number;
  correct: number;
  lastSeenAt: number;
  lastMistakeAt?: number;
  verified: number;
}
export interface WordStat {
  attempts: number;
  correct: number;
  lastSeenAt: number;
  lastMistakeAt?: number;
}
export interface Alignment {
  expected: string;
  actual: string;
  expectedIndex: number | null;
  operation: 'match' | 'replace' | 'insert' | 'delete';
}
export interface UnitEvidence {
  source: string;
  position: number;
  expected: string;
  actual: string;
  observation: number | null;
}
export interface Evaluation {
  status: 'correct' | 'partial' | 'incorrect' | 'unknown' | 'ambiguous';
  correct: boolean;
  expected: string;
  normalizedAnswer: string;
  distance: number;
  alignment: Alignment[];
  units: UnitEvidence[];
}
export interface AttemptEvent {
  id: string;
  type: 'attempt.completed';
  clientId: string;
  timestamp: number;
  schemaVersion: number;
  payload: {
    wordId: string;
    answer: string;
    expected: string;
    correct: boolean;
    shownAt: number;
    answeredAt: number;
    evaluation: Evaluation;
    familiarity: number;
    learnerLanguage: string;
    fontId: string;
  };
}
export interface LearnerState {
  letters: Record<string, LetterStat>;
  words: Record<string, WordStat>;
  recent: AttemptEvent[];
  reinforcement?: { letter: string; remaining: number };
}
