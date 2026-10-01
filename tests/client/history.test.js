import test from 'node:test';
import assert from 'node:assert/strict';
import { countSymbolAppearances, recentHistoryRounds } from '../../src/features/game/history.js';

test('recentHistoryRounds keeps the nine newest server rounds in order', () => {
  const history = Array.from({ length: 10 }, (_, index) => ({
    id: `round-${10 - index}`,
    dice: ['nai', 'bau', 'ga'],
  }));

  assert.deepEqual(recentHistoryRounds(history).map(round => round.id), [
    'round-10',
    'round-9',
    'round-8',
    'round-7',
    'round-6',
    'round-5',
    'round-4',
    'round-3',
    'round-2',
  ]);
});

test('countSymbolAppearances counts real dice occurrences, including duplicates', () => {
  const history = [
    { dice: ['bau', 'bau', 'cua'] },
    { dice: ['nai', 'tom', 'cua'] },
    { dice: ['ga', 'ca', 'cua'] },
  ];

  assert.deepEqual(
    countSymbolAppearances(history, ['nai', 'bau', 'ga', 'ca', 'cua', 'tom']),
    { nai: 1, bau: 2, ga: 1, ca: 1, cua: 3, tom: 1 },
  );
});
