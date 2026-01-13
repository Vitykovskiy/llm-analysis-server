import { DynamicStructuredTool } from '@langchain/core/tools';
import { TaskToolsDeps } from '../types';
import { createTaskTool } from './create-task.tool';
import { deleteTaskTool } from './delete-task.tool';
import { listTasksTool } from './list-tasks.tool';
import { updateTaskTool } from './update-task.tool';
import { vectorAddDocumentTool } from './vector-add-document.tool';
import { vectorDeleteTool } from './vector-delete.tool';
import { vectorGetTool } from './vector-get.tool';
import { vectorSearchTool } from './vector-search.tool';
import { vectorUpdateTool } from './vector-update.tool';

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
