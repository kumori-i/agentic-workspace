import { describe, expect, it } from 'vitest';
import { parseReviewResult } from '../src/desktop/review-result';

describe('independent review authority', () => {
  it.each(['approved', 'changes-requested'])('accepts an explicit structured %s verdict', verdict => {
    expect(parseReviewResult(JSON.stringify({ verdict, summary: 'Checked the requested change.', findings: [], checks: ['Read the diff; no tests run.'], credentials: 'unrecognized' }))).toEqual({ verdict, summary: 'Checked the requested change.', findings: [], checks: ['Read the diff; no tests run.'] });
  });
  it.each([
    '', 'Approved!', '```json\n{"verdict":"approved"}\n```',
    '{"verdict":"approved"}', '{"verdict":"approve","summary":"Fine","findings":[],"checks":[]}',
    '{"verdict":"approved","summary":" ","findings":[],"checks":[]}',
    '{"verdict":"approved","summary":"Fine","findings":[],"checks":"all passed"}',
    JSON.stringify({ verdict: 'approved', summary: 'Fine', findings: Array(31).fill('issue'), checks: [] }),
    JSON.stringify({ verdict: 'approved', summary: 'Fine', findings: [], checks: ['a'.repeat(1001)] }),
    'a'.repeat(12001),
  ])('fails closed for an incomplete or unstructured result (%#)', text => {
    expect(() => parseReviewResult(text)).toThrow();
  });
});
