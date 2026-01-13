import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { DeleteTaskInput, TaskToolsDeps } from '../types';
import { createTool } from './helpers';

const deleteTaskSchema = z
  .object({
    id: z.number().int().positive(),
  })
  .describe('Параметры удаления задачи') as z.ZodTypeAny;

export const deleteTaskTool = (deps: TaskToolsDeps): DynamicStructuredTool =>
  createTool<DeleteTaskInput>({
    name: 'delete_task',
    description:
      'Удалить задачу по id. Используй после подтверждения, что её нужно убрать.',
    schema: deleteTaskSchema,
    func: async (input: DeleteTaskInput) => {
      const { id } = input;
      await deps.tasksService.delete(id);
      return `Удалена задача ${id}`;
    },
  });
