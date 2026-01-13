import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { DeleteVectorInput, TaskToolsDeps } from '../types';
import { createTool } from './helpers';

const deleteVectorSchema = z
  .object({
    id: z.string().min(1),
  })
  .describe('Удалить документ по id') as z.ZodTypeAny;

export const vectorDeleteTool = (deps: TaskToolsDeps): DynamicStructuredTool =>
  createTool<DeleteVectorInput>({
    name: 'vector_delete',
    description: 'Удалить документ из векторного хранилища по id.',
    schema: deleteVectorSchema,
    func: async (input: DeleteVectorInput) => {
      const { id } = input;
      await deps.vectorStoreService.deleteDocument(id);
      return `Удалён векторный документ ${id}`;
    },
  });
