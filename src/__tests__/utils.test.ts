import { extractJSON, getUrgencyCategory, normalizeStatus } from '../lib/utils';

describe('utils.ts', () => {

  describe('extractJSON', () => {
    it('should extract valid JSON from a raw string', () => {
      const raw = `Here is your JSON:
\`\`\`json
{
  "test": "value",
  "number": 123
}
\`\`\``;
      const result = extractJSON<{ test: string, number: number }>(raw);
      expect(result).toEqual({ test: "value", number: 123 });
    });

    it('should ignore <think> blocks and extract JSON', () => {
      const raw = `<think>
This is the AI's internal reasoning.
</think>
{
  "projectTitle": "Test Project"
}`;
      const result = extractJSON<{ projectTitle: string }>(raw);
      expect(result).toEqual({ projectTitle: "Test Project" });
    });

    it('should return null for invalid JSON', () => {
      const raw = `This is just some random text with no JSON in it.`;
      const result = extractJSON(raw);
      expect(result).toBeNull();
    });
  });

  describe('getUrgencyCategory', () => {
    it('should return CRITICAL for < 24 hours', () => {
      expect(getUrgencyCategory(10)).toBe('CRITICAL');
      expect(getUrgencyCategory(23.9)).toBe('CRITICAL');
    });

    it('should return HIGH for < 72 hours', () => {
      expect(getUrgencyCategory(24)).toBe('HIGH');
      expect(getUrgencyCategory(48)).toBe('HIGH');
      expect(getUrgencyCategory(71.9)).toBe('HIGH');
    });

    it('should return MEDIUM for < 168 hours', () => {
      expect(getUrgencyCategory(72)).toBe('MEDIUM');
      expect(getUrgencyCategory(100)).toBe('MEDIUM');
      expect(getUrgencyCategory(167.9)).toBe('MEDIUM');
    });

    it('should return LOW for >= 168 hours', () => {
      expect(getUrgencyCategory(168)).toBe('LOW');
      expect(getUrgencyCategory(200)).toBe('LOW');
    });
  });

  describe('normalizeStatus', () => {
    it('should normalize "done" and "completed" to "Done"', () => {
      expect(normalizeStatus('done')).toBe('Done');
      expect(normalizeStatus('Completed')).toBe('Done');
      expect(normalizeStatus(' DONE ')).toBe('Done');
    });

    it('should normalize "in progress" and "ongoing" to "In Progress"', () => {
      expect(normalizeStatus('in progress')).toBe('In Progress');
      expect(normalizeStatus('ONGOING')).toBe('In Progress');
    });

    it('should default to "Not started" for other inputs', () => {
      expect(normalizeStatus('random string')).toBe('Not started');
      expect(normalizeStatus('')).toBe('Not started');
      expect(normalizeStatus(undefined)).toBe('Not started');
    });
  });

});
