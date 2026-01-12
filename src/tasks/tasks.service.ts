import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type TaskType = 'epic' | 'task' | 'subtask';
export type TaskStatus =
  | 'Открыта'
  | 'Требует уточнения'
  | 'Готова к продолжению'
  | 'Декомпозирована'
  | 'Выполнена';

export interface Task {
  id: number;
  type: TaskType;
  title: string;
  description: string;
  status: TaskStatus;
  code: string;
  createdAt: string;
  parents: { id: number; code: string; title: string }[];
  children: { id: number; code: string; title: string }[];
}

const TASK_TYPES: TaskType[] = ['epic', 'task', 'subtask'];
const TASK_STATUSES: TaskStatus[] = [
  'Открыта',
  'Требует уточнения',
  'Готова к продолжению',
  'Декомпозирована',
  'Выполнена',
];

@Injectable()
export class TasksService {
  constructor(private readonly databaseService: DatabaseService) {}

  async list(): Promise<Task[]> {
    return this.databaseService.listTasks();
  }

  async create(payload: {
    type?: string;
    title?: string;
    description?: string;
    status?: string;
    parentIds?: unknown;
    childIds?: unknown;
  }): Promise<Task> {
    const type = this.parseType(payload.type);
    const title = this.parseTitle(payload.title);
    const description = this.parseDescription(payload.description);
    const status = this.parseStatus(payload.status, 'Открыта');
    const parentIds = this.parseIdArray(payload.parentIds);
    const childIds = this.parseIdArray(payload.childIds);
    await this.ensureIdsExist([...parentIds, ...childIds]);

    const created = await this.databaseService.createTask({
      type,
      title,
      description,
      status,
    });

    await this.databaseService.setTaskRelations(
      created.id,
      parentIds,
      childIds,
    );

    return this.databaseService.getTaskWithRelations(created.id);
  }

  async update(
    id: number,
    payload: {
      type?: string;
      title?: string;
      description?: string;
      status?: string;
      parentIds?: unknown;
      childIds?: unknown;
    },
  ): Promise<Task> {
    const updates: Partial<{
      type: TaskType;
      title: string;
      description: string;
      status: TaskStatus;
    }> = {};

    if (payload.type !== undefined) {
      updates.type = this.parseType(payload.type);
    }
    if (payload.title !== undefined) {
      updates.title = this.parseTitle(payload.title);
    }
    if (payload.description !== undefined) {
      updates.description = this.parseDescription(payload.description);
    }
    if (payload.status !== undefined) {
      updates.status = this.parseStatus(payload.status);
    }

    if (
      !Object.keys(updates).length &&
      payload.parentIds === undefined &&
      payload.childIds === undefined
    ) {
      throw new BadRequestException('Нет данных для обновления');
    }

    const parentIds =
      payload.parentIds !== undefined
        ? this.parseIdArray(payload.parentIds)
        : undefined;
    const childIds =
      payload.childIds !== undefined
        ? this.parseIdArray(payload.childIds)
        : undefined;

    await this.ensureIdsExist([...(parentIds ?? []), ...(childIds ?? [])]);

    try {
      await this.databaseService.updateTask(id, updates);
      await this.databaseService.setTaskRelations(id, parentIds, childIds);
      return await this.databaseService.getTaskWithRelations(id);
    } catch (err) {
      if ((err as Error).message === 'Задача не найдена') {
        throw new NotFoundException(`Задача ${id} не найдена`);
      }
      throw err;
    }
  }

  async delete(id: number): Promise<void> {
    try {
      await this.databaseService.deleteTask(id);
    } catch (err) {
      if ((err as Error).message === 'Задача не найдена') {
        throw new NotFoundException(`Задача ${id} не найдена`);
      }
      throw err;
    }
  }

  private parseType(type?: string): TaskType {
    if (!type) {
      throw new BadRequestException('Тип задачи обязателен');
    }

    if (!TASK_TYPES.includes(type as TaskType)) {
      throw new BadRequestException(
        `Неизвестный тип задачи: ${type}. Допустимо: ${TASK_TYPES.join(', ')}`,
      );
    }

    return type as TaskType;
  }

  private parseStatus(status?: string, fallback?: TaskStatus): TaskStatus {
    if (!status) {
      if (fallback) {
        return fallback;
      }
      throw new BadRequestException('Статус задачи обязателен');
    }

    if (!TASK_STATUSES.includes(status as TaskStatus)) {
      throw new BadRequestException(
        `Неизвестный статус задачи: ${status}. Допустимо: ${TASK_STATUSES.join(', ')}`,
      );
    }

    return status as TaskStatus;
  }

  private parseDescription(description?: string): string {
    const value = description?.trim();
    if (!value) {
      throw new BadRequestException('Описание задачи обязательно');
    }
    return value;
  }

  private parseTitle(title?: string): string {
    const value = title?.trim();
    if (!value) {
      throw new BadRequestException('Название задачи обязательно');
    }
    return value;
  }

  private parseIdArray(value: unknown): number[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      throw new BadRequestException('ID должны быть массивом');
    }
    const ids = value
      .map((item) => Number(item))
      .filter((num) => Number.isFinite(num) && num > 0);
    return Array.from(new Set(ids));
  }

  private async ensureIdsExist(ids: number[]): Promise<void> {
    if (!ids.length) return;
    const existing = await this.databaseService.getTasksByIds(ids);
    const missing = ids.filter(
      (id) => !existing.find((item) => item.id === id),
    );
    if (missing.length) {
      throw new BadRequestException(
        `Задачи с такими ID не найдены: ${missing.join(', ')}`,
      );
    }
  }
}
