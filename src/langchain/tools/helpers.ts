import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

type ToolFactoryInput<TInput> = {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  func: (input: TInput) => Promise<string>;
};

export const createTool = <TInput>(
  fields: ToolFactoryInput<TInput>,
): DynamicStructuredTool => {
  const Ctor = DynamicStructuredTool as unknown as new (
    args: ToolFactoryInput<TInput>,
  ) => DynamicStructuredTool;
  return new Ctor(fields);
};
