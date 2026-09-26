import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, equals, evaluate, exactDiv, format, formatAscii, fromNumbers, mul, sub, toNumbers, trim } from '../../src/topology/poly.ts';

const P = (...c: number[]) => fromNumbers(c);

test('arithmetic is exact', () => {
  assert.deepEqual(toNumbers(add(P(1, 2), P(0, -2, 3))), [1, 0, 3]);
  assert.deepEqual(toNumbers(sub(P(1, 2), P(1, 2))), []);
  assert.deepEqual(toNumbers(mul(P(1, -1, 1), P(1, -1, 1))), [1, -2, 3, -2, 1]);
  assert.equal(evaluate(P(-1, 3, -1), -1n), -5n);
  // Beyond 2^53 nothing is lost.
  const big = mul(P(2 ** 40), P(2 ** 40));
  assert.equal(big[0], 2n ** 80n);
  assert.deepEqual(trim([1n, 0n, 0n]), [1n]);
});

test('exact division recovers factors and rejects inexact ones', () => {
  const a = P(1, -1, 1);
  const b = P(-1, 3, -1);
  assert.ok(equals(exactDiv(mul(a, b), a), b));
  assert.throws(() => exactDiv(P(1, 0, 1), P(1, 1)));
  assert.throws(() => exactDiv(P(3), P(2)));
  assert.throws(() => exactDiv(P(1), P()));
});

test('formatting reads like maths', () => {
  assert.equal(format(P(1, -1, 1)), 't² − t + 1');
  assert.equal(format(P(-1, 3, -1)), '−t² + 3t − 1');
  assert.equal(format(P(1, -1, 1), -1), 't − 1 + t⁻¹');
  assert.equal(format(P()), '0');
  assert.equal(formatAscii(P(2, -3, 2)), '2t^2 - 3t + 2');
});
