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
      const mockDb = {
        id: 'db-1',
        name: 'Mock DB',
        propNames: { title: 'Name', status: 'Status', date: 'Date' },
        propTypes: { status: 'status' }
      };

      const mockRawPages = [
        {
          id: '1',
          properties: {
            Status: { status: { name: 'Done' } },
            Name: { title: [{ plain_text: 'Task 1' }] },
            Date: { date: { start: '2026-05-01' } }
          }
        },
        {
          id: '2',
          properties: {
            Status: { status: { name: 'In Progress' } },
            Name: { title: [{ plain_text: 'Task 2' }] },
            Date: { date: { start: '2026-05-01' } }
          }
        },
      ];
      
      (notionLib.discoverDatabases as jest.Mock).mockResolvedValue([mockDb]);
      (notionLib.getRawNotionTasks as jest.Mock).mockResolvedValue(mockRawPages);

      // 2. Act
      const result = await fetchNotionTasks();

      // 3. Assert: The 'In Progress' task (id: 2) should be first
      expect(result[0].id).toBe('2');
      expect(result[1].id).toBe('1');
    });
  });
});
