import { Injectable } from '@nestjs/common';
import { TaskStatus, TaskType } from '../tasks/tasks.service';
import { DatabaseCoreService } from './database.core.service';

@Injectable()
export class DatabaseTasksService {
  constructor(private readonly db: DatabaseCoreService) {}

  async createTask(task: {
    type: TaskType;
    title: string;
    description: string;
    status: TaskStatus;
  }): Promise<{
    id: number;
    type: TaskType;
    title: string;
    description: string;
    status: TaskStatus;
    code: string;
    createdAt: string;
    parents: { id: number; code: string; title: string }[];
    children: { id: number; code: string; title: string }[];
  }> {
    const next = await this.db.get<{ next: number }>(
      "SELECT COALESCE(MAX(CAST(substr(code, instr(code, '-') + 1) AS INTEGER)), 0) + 1 as next FROM tasks WHERE code LIKE 'TASK-%'",
    );
    const code = `TASK-${String(next?.next ?? 1).padStart(4, '0')}`;

    await this.db.run(
      'INSERT INTO tasks (type, title, description, status, code) VALUES (?, ?, ?, ?, ?)',
      [task.type, task.title, task.description, task.status, code],
    );

    const row = await this.db.get<{
      id: number;
      type: TaskType;
      title: string;
      description: string;
      status: TaskStatus;
      code: string;
      created_at: string;
    }>('SELECT * FROM tasks WHERE id = last_insert_rowid()');

    if (!row) {
      throw new Error('Не удалось создать задачу');
    }

    return {
      id: row.id,
      type: row.type,
      title: row.title,
      description: row.description,
      status: row.status,
      code: row.code,
      createdAt: row.created_at,
      parents: [],
      children: [],
    };
  }

  async listTasks(): Promise<
    {
      id: number;
      type: TaskType;
      title: string;
      description: string;
      status: TaskStatus;
      code: string;
      createdAt: string;
      parents: { id: number; code: string; title: string }[];
      children: { id: number; code: string; title: string }[];
    }[]
  > {
    const rows = await this.db.all<{
      id: number;
      type: TaskType;
      title: string;
      description: string;
      status: TaskStatus;
      code: string;
      created_at: string;
    }>('SELECT * FROM tasks ORDER BY created_at DESC');

    const links = await this.db.all<{ parent_id: number; child_id: number }>(
      'SELECT parent_id, child_id FROM task_links',
    );

    const byId = new Map<
      number,
      {
        id: number;
        type: TaskType;
        title: string;
        description: string;
        status: TaskStatus;
        code: string;
        createdAt: string;
      }
    >(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          type: row.type,
          title: row.title,
          description: row.description,
          status: row.status,
          code: row.code,
          createdAt: row.created_at,
        },
      ]),
    );

    const parentMap = new Map<number, number[]>();
    const childMap = new Map<number, number[]>();

    links.forEach((link) => {
      parentMap.set(link.child_id, [
        ...(parentMap.get(link.child_id) ?? []),
        link.parent_id,
      ]);
      childMap.set(link.parent_id, [
        ...(childMap.get(link.parent_id) ?? []),
        link.child_id,
      ]);
    });

    const result = rows.map((row) => {
      const parents =
        parentMap
          .get(row.id)
          ?.map((id) => byId.get(id))
          .filter(Boolean)
          .map((entry) => ({
            id: entry!.id,
            code: entry!.code,
            title: entry!.title,
          })) ?? [];

      const children =
        childMap
          .get(row.id)
          ?.map((id) => byId.get(id))
          .filter(Boolean)
          .map((entry) => ({
            id: entry!.id,
            code: entry!.code,
            title: entry!.title,
          })) ?? [];

      return {
        id: row.id,
        type: row.type,
        title: row.title,
        description: row.description,
        status: row.status,
        code: row.code,
        createdAt: row.created_at,
        parents,
        children,
      };
    });

    return result;
  }

  async updateTask(
    id: number,
    updates: Partial<{
      type: TaskType;
      title: string;
      description: string;
      status: TaskStatus;
    }>,
  ): Promise<{
    id: number;
    type: TaskType;
    title: string;
    description: string;
    status: TaskStatus;
    code: string;
    createdAt: string;
    parents: { id: number; code: string; title: string }[];
    children: { id: number; code: string; title: string }[];
  }> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.type) {
      sets.push('type = ?');
      params.push(updates.type);
    }
    if (updates.description) {
      sets.push('description = ?');
      params.push(updates.description);
    }
    if (updates.title) {
      sets.push('title = ?');
      params.push(updates.title);
    }
    if (updates.status) {
      sets.push('status = ?');
      params.push(updates.status);
    }

    if (!sets.length) {
      throw new Error('Нет данных для обновления');
    }

    params.push(id);
    await this.db.run(
      `UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`,
      params,
    );

    const row = await this.db.get<{
      id: number;
      type: TaskType;
      title: string;
      description: string;
      status: TaskStatus;
      code: string;
      created_at: string;
    }>('SELECT * FROM tasks WHERE id = ?', [id]);

    if (!row) {
      throw new Error('Задача не найдена');
    }

    return {
      id: row.id,
      type: row.type,
      title: row.title,
      description: row.description,
      status: row.status,
      code: row.code,
      createdAt: row.created_at,
      parents: [],
      children: [],
    };
  }

  async setTaskRelations(
    taskId: number,
    parents?: number[],
    children?: number[],
  ): Promise<void> {
    if (parents) {
      await this.db.run('DELETE FROM task_links WHERE child_id = ?', [taskId]);
      for (const parentId of parents) {
        if (parentId === taskId) continue;
        await this.db.run(
          'INSERT OR IGNORE INTO task_links (parent_id, child_id) VALUES (?, ?)',
          [parentId, taskId],
        );
      }
    }

    if (children) {
      await this.db.run('DELETE FROM task_links WHERE parent_id = ?', [taskId]);
      for (const childId of children) {
        if (childId === taskId) continue;
        await this.db.run(
          'INSERT OR IGNORE INTO task_links (parent_id, child_id) VALUES (?, ?)',
          [taskId, childId],
        );
      }
    }
  }

  async getTaskWithRelations(id: number): Promise<{
    id: number;
    type: TaskType;
    title: string;
    description: string;
    status: TaskStatus;
    code: string;
    createdAt: string;
    parents: { id: number; code: string; title: string }[];
    children: { id: number; code: string; title: string }[];
  }> {
    const task = await this.db.get<{
      id: number;
      type: TaskType;
      title: string;
      description: string;
      status: TaskStatus;
      code: string;
      created_at: string;
    }>('SELECT * FROM tasks WHERE id = ?', [id]);

    if (!task) {
      throw new Error('Задача не найдена');
    }

    const parents = await this.db.all<{
      id: number;
      code: string;
      title: string;
    }>(
      `
        SELECT t.id, t.code, t.title
        FROM tasks t
        INNER JOIN task_links l ON t.id = l.parent_id
        WHERE l.child_id = ?
      `,
      [id],
    );

    const children = await this.db.all<{
      id: number;
      code: string;
      title: string;
    }>(
      `
        SELECT t.id, t.code, t.title
        FROM tasks t
        INNER JOIN task_links l ON t.id = l.child_id
        WHERE l.parent_id = ?
      `,
      [id],
    );

    return {
      id: task.id,
      type: task.type,
      title: task.title,
      description: task.description,
      status: task.status,
      code: task.code,
      createdAt: task.created_at,
      parents,
      children,
    };
  }

  async getTasksByIds(
    ids: number[],
  ): Promise<{ id: number; code: string; title: string }[]> {
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(', ');
    return this.db.all<{ id: number; code: string; title: string }>(
      `SELECT id, code, title FROM tasks WHERE id IN (${placeholders})`,
      ids,
    );
  }

  async deleteTask(id: number): Promise<void> {
    const existing = await this.db.get<{ id: number }>(
      'SELECT id FROM tasks WHERE id = ?',
      [id],
    );

    if (!existing) {
      throw new Error('Задача не найдена');
    }

    await this.db.run(
      'DELETE FROM task_links WHERE parent_id = ? OR child_id = ?',
      [id, id],
    );
    await this.db.run('DELETE FROM tasks WHERE id = ?', [id]);
  }
}
