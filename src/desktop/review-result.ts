/** Only a completed, validated reviewer result may authorize publication. */
export const reviewOutputSchema = {
  type: 'object', additionalProperties: false, required: ['verdict', 'summary', 'findings', 'checks'],
  properties: {
    verdict: { type: 'string', enum: ['approved', 'changes-requested'] },
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    checks: { type: 'array', items: { type: 'string' } },
  },
};
export function parseReviewResult(text: string): { verdict: 'approved' | 'changes-requested'; summary: string; findings: string[]; checks: string[] } {
  if (!text || text.length > 12_000) throw new Error('Quinn did not return a bounded structured review. Run the review again.');
  let value: any;
  try { value = JSON.parse(text); } catch { throw new Error('Quinn’s final review was not valid JSON. No publication was authorized.'); }
  const strings = (items: unknown) => Array.isArray(items) && items.length <= 30 && items.every(item => typeof item === 'string' && item.length <= 1_000);
  if (!value || typeof value !== 'object' || Array.isArray(value) || !['approved', 'changes-requested'].includes(value.verdict)
    || typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 4_000 || !strings(value.findings) || !strings(value.checks)) {
    throw new Error('Quinn returned an invalid review verdict. No publication was authorized.');
  }
  return { verdict: value.verdict, summary: value.summary, findings: value.findings, checks: value.checks };
}
