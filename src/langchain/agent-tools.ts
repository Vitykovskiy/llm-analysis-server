import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  AddVectorInput,
  CreateTaskInput,
  DeleteTaskInput,
  DeleteVectorInput,
  GetVectorInput,
  ListTasksInput,
  SearchVectorInput,
  TaskToolsDeps,
  UpdateTaskInput,
  UpdateVectorInput,
} from './types';

const statusEnum = z.enum([
  'Открыта',
  'Требует уточнения',
  'Готова к продолжению',
  'Декомпозирована',
  'Выполнена',
]);
const typeEnum = z.enum(['epic', 'task', 'subtask']);
const idArray = z
  .array(z.number().int().positive())
  .describe('Список идентификаторов задач');
const vectorMetadata = z
  .record(z.string(), z.unknown())
  .optional()
  .describe('Необязательный объект метаданных');
const addVectorSchema = z
  .object({
    content: z.string().min(1),
    metadata: vectorMetadata,
    id: z.string().min(1).optional(),
  })
  .describe('Добавить документ в векторное хранилище') as z.ZodTypeAny;
const searchVectorSchema = z
  .object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .describe('Поиск похожих документов') as z.ZodTypeAny;
const getVectorSchema = z
  .object({
    id: z.string().min(1),
  })
  .describe('Получить документ по id') as z.ZodTypeAny;
const updateVectorSchema = z
  .object({
    id: z.string().min(1),
    content: z.string().min(1).optional(),
    metadata: vectorMetadata,
  })
  .describe('Обновить содержимое и/или метаданные документа') as z.ZodTypeAny;
const deleteVectorSchema = z
  .object({
    id: z.string().min(1),
  })
  .describe('Удалить документ по id') as z.ZodTypeAny;
const listTasksSchema = z
  .object({
    status: statusEnum.optional().describe('Необязательный фильтр по статусу'),
  })
  .describe('Параметры получения задач') as z.ZodTypeAny;
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
const deleteTaskSchema = z
  .object({
    id: z.number().int().positive(),
  })
  .describe('Параметры удаления задачи') as z.ZodTypeAny;

export const listTasksTool = (deps: TaskToolsDeps): DynamicStructuredTool =>
  new DynamicStructuredTool({
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

export const createTaskTool = (deps: TaskToolsDeps): DynamicStructuredTool =>
  new DynamicStructuredTool({
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

export const updateTaskTool = (deps: TaskToolsDeps): DynamicStructuredTool =>
  new DynamicStructuredTool({
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

export const deleteTaskTool = (deps: TaskToolsDeps): DynamicStructuredTool =>
  new DynamicStructuredTool({
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

export const vectorAddDocumentTool = (
  deps: TaskToolsDeps,
): DynamicStructuredTool =>
  new DynamicStructuredTool({
    name: 'vector_add_document',
    description:
      'Добавить документ в векторное хранилище Chroma. Передай текст и при необходимости метаданные/id.',
    schema: addVectorSchema,
    func: async (input: AddVectorInput) => {
      const { content, metadata, id } = input;
      const result = await deps.vectorStoreService.addDocument({
        content,
        metadata,
        id,
      });
      return `Добавлен векторный документ с id ${result.id}`;
    },
  });

export const vectorSearchTool = (deps: TaskToolsDeps): DynamicStructuredTool =>
  new DynamicStructuredTool({
    name: 'vector_search',
    description:
      'Поиск похожих документов в векторном хранилище. Передай запрос и необязательный лимит (1-10).',
    schema: searchVectorSchema,
    func: async (input: SearchVectorInput) => {
      const { query, limit } = input;
      const results = await deps.vectorStoreService.similaritySearch(
        query,
        limit ?? 3,
      );
      if (!results.length) return 'Похожие документы не найдены.';
      return JSON.stringify(results, null, 2);
    },
  });

export const vectorGetTool = (deps: TaskToolsDeps): DynamicStructuredTool =>
  new DynamicStructuredTool({
    name: 'vector_get',
    description: 'Получить документ из векторного хранилища по id.',
    schema: getVectorSchema,
    func: async (input: GetVectorInput) => {
      const { id } = input;
      const doc = await deps.vectorStoreService.getDocument(id);
      if (!doc) return `Документ ${id} не найден.`;
      return JSON.stringify(doc, null, 2);
    },
  });

export const vectorUpdateTool = (deps: TaskToolsDeps): DynamicStructuredTool =>
  new DynamicStructuredTool({
    name: 'vector_update',
    description:
      'Обновить содержимое и/или метаданные документа в векторном хранилище. Передай id и поля для изменения.',
    schema: updateVectorSchema,
    func: async (input: UpdateVectorInput) => {
      const { id, content, metadata } = input;
      const result = await deps.vectorStoreService.updateDocument({
        id,
        content,
        metadata,
      });
      return `Обновлён векторный документ ${result.id}`;
    },
  });

export const vectorDeleteTool = (deps: TaskToolsDeps): DynamicStructuredTool =>
  new DynamicStructuredTool({
    name: 'vector_delete',
    description: 'Удалить документ из векторного хранилища по id.',
    schema: deleteVectorSchema,
    func: async (input: DeleteVectorInput) => {
      const { id } = input;
      await deps.vectorStoreService.deleteDocument(id);
      return `Удалён векторный документ ${id}`;
    },
  });

export const buildTaskTools = (
  deps: TaskToolsDeps,
): DynamicStructuredTool[] => [
  listTasksTool(deps),
  createTaskTool(deps),
  updateTaskTool(deps),
  deleteTaskTool(deps),
  vectorAddDocumentTool(deps),
  vectorSearchTool(deps),
  vectorGetTool(deps),
  vectorUpdateTool(deps),
  vectorDeleteTool(deps),
];
