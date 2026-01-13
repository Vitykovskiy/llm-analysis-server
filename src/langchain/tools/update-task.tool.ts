import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { TaskStatus, TaskType } from '../../tasks/tasks.service';
import { TaskToolsDeps, UpdateTaskInput } from '../types';
import { createTool } from './helpers';

const statusValues = Object.values(TaskStatus) as [TaskStatus, ...TaskStatus[]];
const statusEnum = z.enum(statusValues);
const typeEnum = z.enum(Object.values(TaskType) as [TaskType, ...TaskType[]]);
const idArray = z
  .array(z.number().int().positive())
  .describe('Список идентификаторов задач');
const updateTaskSchema = z
  .object({
    id: z.number().int().positive(),
    type: typeEnum.optional(),
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    status: statusEnum.optional(),
    parentIds: idArray.optional(),
    childIds: idArray.optional(),
  })
  .describe('Параметры обновления задачи') as z.ZodTypeAny;

export const updateTaskTool = (deps: TaskToolsDeps): DynamicStructuredTool =>
  createTool<UpdateTaskInput>({
    name: 'update_task',
    description:
      'Обновить поля или связи существующей задачи. Передай id и только те поля, что нужно изменить.',
    schema: updateTaskSchema,
    func: async (input: UpdateTaskInput) => {
      const { id, ...payload } = input;
      const updated = await deps.tasksService.update(id, payload);
      return `Обновлена задача ${id}:\n${deps.formatTask(updated)}`;
    },
  });
