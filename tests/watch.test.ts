import { describe, it, expect } from 'vitest';
import { pendingIssues } from '../src/watch.ts';

describe('pendingIssues', () => {
  it('excluye issues ya terminados, en PR o atascados', () => {
    const issues = [
      { number: 1, labels: ['factory'] },
      { number: 2, labels: ['factory', 'factory:awaiting-spec'] },
      { number: 3, labels: ['factory', 'factory:pr'] },
      { number: 4, labels: ['factory', 'factory:merged'] },
      { number: 5, labels: ['factory', 'factory:stuck'] },
      { number: 6, labels: ['factory', 'factory:paused'] },
    ];
    expect(pendingIssues(issues)).toEqual([1, 2, 6]);
  });
});
