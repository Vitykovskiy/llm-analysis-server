import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { SearchVectorInput, TaskToolsDeps } from '../types';
import { createTool } from './helpers';

const searchVectorSchema = z
  .object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .describe('Поиск похожих документов') as z.ZodTypeAny;

export const vectorSearchTool = (deps: TaskToolsDeps): DynamicStructuredTool =>
  createTool<SearchVectorInput>({
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
