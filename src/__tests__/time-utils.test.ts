import { calculateDeadlineInfo, getUserLocalTime } from '../lib/utils';

describe('time-utils', () => {

  describe('getUserLocalTime', () => {
    it('should calculate local time based on positive offset', () => {
      // Mock new Date() for predictable results if needed, but since it's relative we can just check the difference
      const { now, localNow } = getUserLocalTime('+05:30');
      const diffMs = localNow.getTime() - now.getTime();
      expect(diffMs).toBe((5 * 60 + 30) * 60000);
    });

    it('should calculate local time based on negative offset', () => {
      const { now, localNow } = getUserLocalTime('-04:00');
      const diffMs = localNow.getTime() - now.getTime();
      expect(diffMs).toBe(-(4 * 60) * 60000);
    });

    it('should default to no offset if invalid', () => {
      const { now, localNow } = getUserLocalTime('invalid');
      const diffMs = localNow.getTime() - now.getTime();
      expect(diffMs).toBe(0);
    });
  });

  describe('calculateDeadlineInfo', () => {
    it('should handle "No Deadline"', () => {
      const now = new Date();
      const localNow = new Date();
      const result = calculateDeadlineInfo("No Deadline", localNow, now);
      expect(result.deadlineLabel).toBe("No Deadline");
      expect(result.relativeInfo).toBe("");
    });

    it('should handle date-only deadlines in the future', () => {
      const localNow = new Date("2024-01-01T12:00:00Z");
      const now = new Date("2024-01-01T12:00:00Z");
      // Future date 2 days away
      const result = calculateDeadlineInfo("2024-01-03", localNow, now);
      
      expect(result.deadlineLabel).toContain("Jan 3, 2024");
      expect(result.relativeInfo).toContain("due in 2 days");
      expect(result.relativeInfo).toContain("Urgency: HIGH"); // 48 hours is HIGH
    });

    it('should handle datetime deadlines in the future', () => {
      const now = new Date("2024-01-01T12:00:00Z");
      const localNow = new Date("2024-01-01T12:00:00Z");
      // Future datetime 2 hours away
      const deadline = new Date(now.getTime() + 2 * 3600000).toISOString();
      const result = calculateDeadlineInfo(deadline, localNow, now);
      
      expect(result.relativeInfo).toContain("due in 2h 0m");
      expect(result.relativeInfo).toContain("Urgency: CRITICAL"); // 2 hours is CRITICAL
    });

    it('should handle overdue datetime deadlines', () => {
      const now = new Date("2024-01-01T12:00:00Z");
      const localNow = new Date("2024-01-01T12:00:00Z");
      // Overdue by 2 hours
      const deadline = new Date(now.getTime() - 2 * 3600000).toISOString();
      const result = calculateDeadlineInfo(deadline, localNow, now);
      
      expect(result.relativeInfo).toContain("2h 0m overdue");
      expect(result.relativeInfo).toContain("Urgency: CRITICAL"); 
    });
  });

});
