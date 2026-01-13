import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { TaskStatus } from '../../tasks/tasks.service';
import { ListTasksInput, TaskToolsDeps } from '../types';
import { createTool } from './helpers';

const statusValues = Object.values(TaskStatus) as [TaskStatus, ...TaskStatus[]];
const statusEnum = z.enum(statusValues);
const listTasksSchema = z
  .object({
    status: statusEnum.optional().describe('Необязательный фильтр по статусу'),
  })
  .describe('Параметры получения задач') as z.ZodTypeAny;

export const listTasksTool = (deps: TaskToolsDeps): DynamicStructuredTool =>
  createTool<ListTasksInput>({
    name: 'list_tasks',
    description:
      'Список задач с кодами, статусами, типами и связями. Используй, чтобы понять текущие работы.',
    schema: listTasksSchema,
    func: async (input: ListTasksInput) => {
      const { status } = input;
      const tasks = await deps.tasksService.list();
      const filtered = status
        ? tasks.filter((task) => task.status === status)
        : tasks;

      if (!filtered.length) {
        return 'Задач по фильтру не найдено.';
      }

      return filtered.map((task) => deps.formatTask(task)).join('\n---\n');
    },
  });
