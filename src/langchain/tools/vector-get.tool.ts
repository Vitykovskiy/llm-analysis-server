import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { GetVectorInput, TaskToolsDeps } from '../types';
import { createTool } from './helpers';

const getVectorSchema = z
  .object({
    id: z.string().min(1),
  })
  .describe('Получить документ по id') as z.ZodTypeAny;

export const vectorGetTool = (deps: TaskToolsDeps): DynamicStructuredTool =>
  createTool<GetVectorInput>({
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
