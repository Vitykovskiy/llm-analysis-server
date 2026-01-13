import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { TaskStatus, TaskType } from '../../tasks/tasks.service';
import { CreateTaskInput, TaskToolsDeps } from '../types';
import { createTool } from './helpers';

const statusValues = Object.values(TaskStatus) as [TaskStatus, ...TaskStatus[]];
const statusEnum = z.enum(statusValues);
const typeEnum = z.enum(Object.values(TaskType) as [TaskType, ...TaskType[]]);
const idArray = z
  .array(z.number().int().positive())
  .describe('Список идентификаторов задач');
const createTaskSchema = z
  .object({
    type: typeEnum,
    title: z.string().min(1),
    description: z.string().min(1),
    status: statusEnum.optional(),
    parentIds: idArray.optional(),
    childIds: idArray.optional(),
  })
  .describe('Параметры создания задачи') as z.ZodTypeAny;

export const createTaskTool = (deps: TaskToolsDeps): DynamicStructuredTool =>
  createTool<CreateTaskInput>({
    name: 'create_task',
    description:
      'Создать задачу или эпик с необязательными связями родитель/потомок. Обязательно укажи название и описание.',
    schema: createTaskSchema,
    func: async (input: CreateTaskInput) => {
      const { type, title, description, status, parentIds, childIds } = input;
      const created = await deps.tasksService.create({
        type,
        title,
        description,
        status,
        parentIds,
        childIds,
      });
      return `Создана задача:\n${deps.formatTask(created)}`;
    },
  });
