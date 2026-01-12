import type { Task, TasksService } from '../tasks/tasks.service';
import type { VectorStoreService } from './vector-store.service';

export type TaskToolsDeps = {
  tasksService: TasksService;
  vectorStoreService: VectorStoreService;
  formatTask: (task: Task) => string;
};

export type StatusValue =
  | 'Открыта'
  | 'Требует уточнения'
  | 'Готова к продолжению'
  | 'Декомпозирована'
  | 'Выполнена';

export type TaskTypeValue = 'epic' | 'task' | 'subtask';

export type ListTasksInput = {
  status?: StatusValue;
};

export type CreateTaskInput = {
  type: TaskTypeValue;
  title: string;
  description: string;
  status?: StatusValue;
  parentIds?: number[];
  childIds?: number[];
};

export type UpdateTaskInput = {
  id: number;
  type?: TaskTypeValue;
  title?: string;
  description?: string;
  status?: StatusValue;
  parentIds?: number[];
  childIds?: number[];
};

export type DeleteTaskInput = {
  id: number;
};

export type AddVectorInput = {
  content: string;
  metadata?: Record<string, unknown>;
  id?: string;
};

export type SearchVectorInput = {
  query: string;
  limit?: number;
};

export type GetVectorInput = {
  id: string;
};

export type UpdateVectorInput = {
  id: string;
  content?: string;
  metadata?: Record<string, unknown>;
};

export type DeleteVectorInput = {
  id: string;
};

export type ChromaCollectionGetResult = {
  ids?: string[];
  documents?: string[];
  metadatas?: Record<string, unknown>[];
  distances?: number[];
};

export type ChromaCollection = {
  get?: (params: {
    ids: string[];
    include?: string[];
  }) => Promise<ChromaCollectionGetResult>;
  update?: (params: {
    ids: string[];
    documents?: string[];
    metadatas?: Record<string, unknown>[];
  }) => Promise<void>;
  add?: (params: {
    ids: string[];
    documents: string[];
    metadatas?: Record<string, unknown>[];
  }) => Promise<void>;
  delete?: (params: { ids: string[] }) => Promise<void>;
};
