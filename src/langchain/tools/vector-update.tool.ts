import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { TaskToolsDeps, UpdateVectorInput } from '../types';
import { createTool } from './helpers';

const vectorMetadata = z
  .record(z.string(), z.unknown())
  .optional()
  .describe('Необязательный объект метаданных');
const updateVectorSchema = z
  .object({
    id: z.string().min(1),
    content: z.string().min(1).optional(),
    metadata: vectorMetadata,
  })
  .describe('Обновить содержимое и/или метаданные документа') as z.ZodTypeAny;

export const vectorUpdateTool = (deps: TaskToolsDeps): DynamicStructuredTool =>
  createTool<UpdateVectorInput>({
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
