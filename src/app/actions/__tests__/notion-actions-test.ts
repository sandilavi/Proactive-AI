import { fetchNotionTasks } from '../notion-actions';
import * as notionLib from '@/lib/notion'; // mock this

// Mocking the external dependencies
jest.mock('@/lib/notion');
jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
  unstable_cache: jest.fn(),
}));

describe('notion-actions', () => {
  describe('fetchNotionTasks sorting logic', () => {
    test('should sort "Done" tasks to the bottom', async () => {
      // 1. Arrange: Mock the DB data to return unsorted tasks
      const mockTasks = [
        { id: '1', status: 'Done', deadline: '2026-05-01' },
        { id: '2', status: 'In Progress', deadline: '2026-05-01' },
      ];
      
      // Force fetchTasksFromDatabase mock to return this
      (notionLib.getRawNotionTasks as jest.Mock).mockResolvedValue(mockTasks);

      // 2. Act
      const result = await fetchNotionTasks();

      // 3. Assert: The 'In Progress' task (id: 2) should be first
      expect(result[0].id).toBe('2');
      expect(result[1].id).toBe('1');
    });
  });
});
