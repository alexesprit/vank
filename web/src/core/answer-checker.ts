import type { Alignment, Evaluation, Word } from '../../../shared/types.ts';

export function normalizeAnswer(answer: string): string {
  return answer.normalize('NFC').trim().toLowerCase().replace(/\s+/gu, ' ');
}
function align(expected: string, actual: string): { distance: number; alignment: Alignment[]; recognized: (boolean | null)[] } {
  const a = [...expected], b = [...actual];
  const costs = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i ? (j ? 0 : i) : j));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const options = [costs[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]), costs[i - 1][j] + 1, costs[i][j - 1] + 1];
    const best = Math.min(...options); costs[i][j] = best;
  }
  const remaining = costs.map(row => row.map(() => 0));
  for (let i = a.length; i >= 0; i--) for (let j = b.length; j >= 0; j--) {
    if (i === a.length) remaining[i][j] = b.length - j;
    else if (j === b.length) remaining[i][j] = a.length - i;
    else remaining[i][j] = Math.min(remaining[i + 1][j + 1] + Number(a[i] !== b[j]), remaining[i + 1][j] + 1, remaining[i][j + 1] + 1);
  }
  const recognized = a.map((letter, i) => {
    const observations = new Set<boolean>();
    for (let j = 0; j <= b.length; j++) {
      if (costs[i][j] + 1 + remaining[i + 1][j] === costs[a.length][b.length]) observations.add(false);
      if (j < b.length && costs[i][j] + Number(letter !== b[j]) + remaining[i + 1][j + 1] === costs[a.length][b.length]) observations.add(letter === b[j]);
    }
    return observations.size === 1 ? [...observations][0] : null;
  });
  const alignment: Alignment[] = [];
  let i = a.length, j = b.length;
  while (i || j) {
    if (i && j && costs[i][j] === costs[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1])) {
      alignment.push({ expected: a[i - 1], actual: b[j - 1], expectedIndex: i - 1, operation: a[i - 1] === b[j - 1] ? 'match' : 'replace' }); i--; j--;
    } else if (i && costs[i][j] === costs[i - 1][j] + 1) {
      alignment.push({ expected: a[i - 1], actual: '', expectedIndex: i - 1, operation: 'delete' }); i--;
    } else {
      alignment.push({ expected: '', actual: b[j - 1], expectedIndex: null, operation: 'insert' }); j--;
    }
  }
  return { distance: costs[a.length][b.length], alignment: alignment.reverse(), recognized };
}
export function evaluate(word: Word, answer: string, skipped = false): Evaluation {
  const normalizedAnswer = normalizeAnswer(answer);
  const isCyrillic = /\p{Script=Cyrillic}/u.test(normalizedAnswer);
  const mixed = isCyrillic && /\p{Script=Latin}/u.test(normalizedAnswer);
  const script = isCyrillic ? 'cyrillic' : 'latin';
  const accepted = (isCyrillic ? word.acceptedCyrillic : word.acceptedLatin).map(normalizeAnswer);
  // Input length is bounded in the UI and here so edit alignment cannot allocate unbounded memory.
  const supplied = normalizedAnswer.slice(0, 256);
  const candidates = accepted.map(expected => ({ expected, ...align(expected, supplied) })).sort((a, b) => a.distance - b.distance);
  const best = candidates[0];
  const unknown = skipped || !normalizedAnswer;
  const correct = !unknown && !mixed && normalizedAnswer.length <= 256 && best.distance === 0;
  const canonical = word.units?.map(u => normalizeAnswer(u[script])).join('');
  let offset = 0;
  const units = (word.units ?? []).map((u, position) => {
    const expected = normalizeAnswer(u[script]), start = offset; offset += [...expected].length;
    const parts = best.alignment.filter(a => a.expectedIndex !== null && a.expectedIndex >= start && a.expectedIndex < offset);
    const evidence = best.recognized.slice(start, offset);
    return { source: u.source, position, expected, actual: parts.map(p => p.actual).join(''),
      observation: unknown ? 0 : mixed || canonical !== best.expected ? null : evidence.includes(false) ? 0 : evidence.includes(null) ? null : 1 };
  });
  const ambiguous = mixed || (!correct && (units.some(u => u.observation === null) || candidates.some(c => c !== best && c.distance === best.distance)));
  return {
    status: unknown ? 'unknown' : correct ? 'correct' : ambiguous ? 'ambiguous' : best.distance < best.expected.length / 2 ? 'partial' : 'incorrect',
    correct, expected: best.expected, normalizedAnswer, distance: best.distance, alignment: best.alignment, units,
  };
}
