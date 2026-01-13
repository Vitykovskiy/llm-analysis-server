import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { AddVectorInput, TaskToolsDeps } from '../types';
import { createTool } from './helpers';

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

export const vectorAddDocumentTool = (
  deps: TaskToolsDeps,
): DynamicStructuredTool =>
  createTool<AddVectorInput>({
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
