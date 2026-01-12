import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Database, verbose } from 'sqlite3';
import { TaskStatus, TaskType } from '../tasks/tasks.service';

const sqlite3 = verbose();

export enum ArtifactKind {
  Text = 'text',
  Diagram = 'diagram',
}

export enum ArtifactCategory {
  UseCaseDiagram = 'use_case_diagram',
  ErDiagram = 'er_diagram',
  EntityDiagram = 'entity_diagram',
  UserScenario = 'user_scenario',
  FunctionalRequirement = 'functional_requirement',
  NonFunctionalRequirement = 'non_functional_requirement',
  AcceptanceCriteria = 'acceptance_criteria',
  UseCaseDiagramUpper = 'USE_CASE_DIAGRAM',
  EntityDiagramUpper = 'ENTITY_DIAGRAM',
  UserScenarioUpper = 'USER_SCENARIO',
  FunctionalRequirementsUpper = 'FUNCTIONAL_REQUIREMENTS',
  NonFunctionalRequirementsUpper = 'NON_FUNCTIONAL_REQUIREMENTS',
  AcceptanceCriteriaUpper = 'ACCEPTANCE_CRITERIA',
}

export enum ArtifactFormat {
  Markdown = 'markdown',
  Plantuml = 'plantuml',
  Text = 'text',
}

export enum ArtifactSourceType {
  Task = 'task',
  Message = 'message',
  Manual = 'manual',
}

export enum ArtifactExportFormat {
  Markdown = 'markdown',
  Docx = 'docx',
  Png = 'png',
  Plantuml = 'plantuml',
}

export interface ArtifactSnapshot {
  artifactId: number;
  title: string;
  kind: ArtifactKind;
  category: ArtifactCategory;
  version: number;
  format: ArtifactFormat;
  content: string;
  renderUrl?: string | null;
  createdAt: string;
}

const TASK_STATUS_VALUES = Object.values(TaskStatus);
const TASK_STATUS_CHECK = `status IN ('${TASK_STATUS_VALUES.join("','")}')`;

const ARTIFACT_KIND_VALUES = [ArtifactKind.Text, ArtifactKind.Diagram];
const ARTIFACT_CATEGORY_DB_VALUES = [
  ArtifactCategory.UseCaseDiagram,
  ArtifactCategory.ErDiagram,
  ArtifactCategory.EntityDiagram,
  ArtifactCategory.UserScenario,
  ArtifactCategory.FunctionalRequirement,
  ArtifactCategory.NonFunctionalRequirement,
  ArtifactCategory.AcceptanceCriteria,
];
const ARTIFACT_FORMAT_VALUES = [
  ArtifactFormat.Markdown,
  ArtifactFormat.Plantuml,
  ArtifactFormat.Text,
];
const ARTIFACT_SOURCE_VALUES = [
  ArtifactSourceType.Task,
  ArtifactSourceType.Message,
  ArtifactSourceType.Manual,
];
const ARTIFACT_EXPORT_FORMAT_VALUES = [
  ArtifactExportFormat.Markdown,
  ArtifactExportFormat.Docx,
  ArtifactExportFormat.Png,
  ArtifactExportFormat.Plantuml,
];
const ARTIFACT_KIND_CHECK = `kind IN ('${ARTIFACT_KIND_VALUES.join("','")}')`;
const ARTIFACT_CATEGORY_CHECK = `category IN ('${ARTIFACT_CATEGORY_DB_VALUES.join(
  "','",
)}')`;
const ARTIFACT_FORMAT_CHECK = `format IN ('${ARTIFACT_FORMAT_VALUES.join(
  "','",
)}')`;
const ARTIFACT_SOURCE_CHECK = `source_type IN ('${ARTIFACT_SOURCE_VALUES.join(
  "','",
)}')`;
const ARTIFACT_EXPORT_FORMAT_CHECK = `format IN ('${ARTIFACT_EXPORT_FORMAT_VALUES.join(
  "','",
)}')`;

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private db?: Database;
  private readonly logger = new Logger(DatabaseService.name);
  private readonly dbFile = join(process.cwd(), 'data', 'app.sqlite');

  async onModuleInit(): Promise<void> {
    this.ensureDirectory();
    this.db = new sqlite3.Database(this.dbFile);
    await this.run('PRAGMA foreign_keys = ON');
    await this.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_text TEXT NOT NULL,
        bot_reply TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('epic', 'task', 'subtask')),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL CHECK (${TASK_STATUS_CHECK}),
        code TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.run(`
      CREATE TABLE IF NOT EXISTS task_links (
        parent_id INTEGER NOT NULL,
        child_id INTEGER NOT NULL,
        PRIMARY KEY (parent_id, child_id)
      )
    `);
    await this.run(
      "ALTER TABLE tasks ADD COLUMN title TEXT NOT NULL DEFAULT ''",
    ).catch(() => undefined);
    await this.ensureTaskStatusConstraint();
    await this.ensureTaskCodeColumn();
    await this.ensureArtifactSchema();
    this.logger.log(`SQLite готов: ${this.dbFile}`);
  }

  private async ensureTaskCodeColumn(): Promise<void> {
    const columns = await this.all<{ name: string }>(
      "PRAGMA table_info('tasks')",
    );
    const hasCode = columns.some((col) => col.name === 'code');

    if (!hasCode) {
      await this.run('ALTER TABLE tasks ADD COLUMN code TEXT');

      const existing = await this.all<{ id: number }>(
        'SELECT id FROM tasks ORDER BY id ASC',
      );
      for (let idx = 0; idx < existing.length; idx += 1) {
        const code = `TASK-${String(idx + 1).padStart(4, '0')}`;
        await this.run('UPDATE tasks SET code = ? WHERE id = ?', [
          code,
          existing[idx].id,
        ]);
      }
    }

    await this.run(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_code ON tasks(code)',
    );
  }

  private ensureDirectory(): void {
    const dir = join(process.cwd(), 'data');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private async ensureTaskStatusConstraint(): Promise<void> {
    const row = await this.get<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'",
    );
    const expectedCheck = TASK_STATUS_CHECK;

    if (row?.sql?.includes(expectedCheck)) {
      return;
    }

    this.logger.warn(
      'Миграция таблицы tasks на новый набор статусов (Открыта, Требует уточнения, Готова к продолжению, Декомпозирована, Выполнена)',
    );

    await this.run('PRAGMA foreign_keys=off');
    await this.run('ALTER TABLE tasks RENAME TO tasks_old');
    await this.run(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('epic', 'task', 'subtask')),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL CHECK (${expectedCheck}),
        code TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.run(`
      INSERT INTO tasks (id, type, title, description, status, code, created_at)
      SELECT
        id,
        type,
        title,
        description,
        CASE status
          WHEN 'backlog' THEN '${TaskStatus.Open}'
          WHEN 'in_progress' THEN '${TaskStatus.ReadyForFollowUp}'
          WHEN 'done' THEN '${TaskStatus.Done}'
          WHEN 'Open' THEN '${TaskStatus.Open}'
          WHEN 'Drafted' THEN '${TaskStatus.Decomposed}'
          WHEN 'RequiresClarification' THEN '${TaskStatus.NeedsClarification}'
          WHEN 'Ready' THEN '${TaskStatus.ReadyForFollowUp}'
          WHEN 'Done' THEN '${TaskStatus.Done}'
          ELSE '${TaskStatus.Open}'
        END as status,
        code,
        created_at
      FROM tasks_old
    `);
    await this.run('DROP TABLE tasks_old');
    await this.run('PRAGMA foreign_keys=on');
    await this.run(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_code ON tasks(code)',
    );
  }

  private async ensureArtifactSchema(): Promise<void> {
    await this.run(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (${ARTIFACT_KIND_CHECK}),
        category TEXT NOT NULL CHECK (${ARTIFACT_CATEGORY_CHECK}),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS artifact_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artifact_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        format TEXT NOT NULL CHECK (${ARTIFACT_FORMAT_CHECK}),
        content TEXT NOT NULL,
        render_url TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE,
        UNIQUE(artifact_id, version)
      )
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS artifact_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artifact_id INTEGER NOT NULL,
        source_type TEXT NOT NULL CHECK (${ARTIFACT_SOURCE_CHECK}),
        source_id INTEGER,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
      )
    `);

    await this.run(`
      CREATE TABLE IF NOT EXISTS artifact_exports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artifact_version_id INTEGER NOT NULL,
        format TEXT NOT NULL CHECK (${ARTIFACT_EXPORT_FORMAT_CHECK}),
        content TEXT,
        location TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (artifact_version_id) REFERENCES artifact_versions(id) ON DELETE CASCADE,
        CHECK (content IS NOT NULL OR location IS NOT NULL)
      )
    `);

    await this.run(
      'CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact_id ON artifact_versions(artifact_id)',
    );
    await this.run(
      'CREATE INDEX IF NOT EXISTS idx_artifact_sources_artifact_id ON artifact_sources(artifact_id)',
    );
    await this.run(
      'CREATE INDEX IF NOT EXISTS idx_artifact_exports_version_id ON artifact_exports(artifact_version_id)',
    );
  }

  async saveMessage(
    userText: string,
    botReply: string,
  ): Promise<{
    id: number;
    userText: string;
    botReply: string;
    createdAt: string;
  }> {
    await this.run(
      'INSERT INTO messages (user_text, bot_reply) VALUES (?, ?)',
      [userText, botReply],
    );

    const row = await this.get<{
      id: number;
      user_text: string;
      bot_reply: string;
      created_at: string;
    }>(
      'SELECT id, user_text, bot_reply, created_at FROM messages WHERE id = last_insert_rowid()',
    );

    if (!row) {
      throw new Error('Не удалось прочитать сохраненное сообщение');
    }

    return {
      id: row.id,
      userText: row.user_text,
      botReply: row.bot_reply,
      createdAt: row.created_at,
    };
  }

  async getRecentMessages(limit = 10): Promise<
    {
      id: number;
      userText: string;
      botReply: string;
      createdAt: string;
    }[]
  > {
    const rows = await this.all<{
      id: number;
      user_text: string;
      bot_reply: string;
      created_at: string;
    }>(
      'SELECT id, user_text, bot_reply, created_at FROM messages ORDER BY created_at DESC LIMIT ?',
      [limit],
    );
    return rows
      .map((row) => ({
        id: row.id,
        userText: row.user_text,
        botReply: row.bot_reply,
        createdAt: row.created_at,
      }))
      .reverse();
  }

  async clearMessages(): Promise<void> {
    await this.run('DELETE FROM messages');
  }

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
    const next = await this.get<{ next: number }>(
      "SELECT COALESCE(MAX(CAST(substr(code, instr(code, '-') + 1) AS INTEGER)), 0) + 1 as next FROM tasks WHERE code LIKE 'TASK-%'",
    );
    const code = `TASK-${String(next?.next ?? 1).padStart(4, '0')}`;

    await this.run(
      'INSERT INTO tasks (type, title, description, status, code) VALUES (?, ?, ?, ?, ?)',
      [task.type, task.title, task.description, task.status, code],
    );

    const row = await this.get<{
      id: number;
      type: TaskType;
      title: string;
      description: string;
      status: TaskStatus;
      code: string;
      created_at: string;
    }>('SELECT * FROM tasks WHERE id = last_insert_rowid()');

    if (!row) {
      throw new Error('Не удалось прочитать сохраненную задачу');
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
    const rows = await this.all<{
      id: number;
      type: TaskType;
      title: string;
      description: string;
      status: TaskStatus;
      code: string;
      created_at: string;
    }>('SELECT * FROM tasks ORDER BY created_at DESC');

    const links = await this.all<{ parent_id: number; child_id: number }>(
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
      throw new Error('Нет полей для обновления');
    }

    params.push(id);
    await this.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, params);

    const row = await this.get<{
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
      await this.run('DELETE FROM task_links WHERE child_id = ?', [taskId]);
      for (const parentId of parents) {
        if (parentId === taskId) continue;
        await this.run(
          'INSERT OR IGNORE INTO task_links (parent_id, child_id) VALUES (?, ?)',
          [parentId, taskId],
        );
      }
    }

    if (children) {
      await this.run('DELETE FROM task_links WHERE parent_id = ?', [taskId]);
      for (const childId of children) {
        if (childId === taskId) continue;
        await this.run(
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
    const task = await this.get<{
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

    const parents = await this.all<{
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

    const children = await this.all<{
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
    return this.all<{ id: number; code: string; title: string }>(
      `SELECT id, code, title FROM tasks WHERE id IN (${placeholders})`,
      ids,
    );
  }

  async saveArtifactWithVersion(input: {
    artifactId?: number;
    title: string;
    kind: ArtifactKind;
    category: ArtifactCategory;
    format: ArtifactFormat;
    content: string;
    renderUrl?: string | null;
    note?: string | null;
    sourceTaskIds?: number[];
    sourceMessageIds?: number[];
  }): Promise<ArtifactSnapshot> {
    const trimmedContent = input.content?.trim();
    const title = input.title?.trim();

    if (!trimmedContent) {
      throw new Error('Содержимое артефакта обязательно');
    }

    if (!title) {
      throw new Error('Название артефакта обязательно');
    }

    const normalizedCategory = this.normalizeCategory(input.category);

    const artifactId = await this.upsertArtifactRecord({
      id: input.artifactId,
      title,
      kind: input.kind,
      category: normalizedCategory,
    });

    const nextVersion = await this.get<{ next: number }>(
      'SELECT COALESCE(MAX(version), 0) + 1 as next FROM artifact_versions WHERE artifact_id = ?',
      [artifactId],
    );

    await this.run(
      `INSERT INTO artifact_versions (artifact_id, version, format, content, render_url, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        artifactId,
        nextVersion?.next ?? 1,
        input.format,
        trimmedContent,
        input.renderUrl ?? null,
        input.note ?? null,
      ],
    );

    await this.attachArtifactSources(
      artifactId,
      input.sourceTaskIds,
      input.sourceMessageIds,
    );

    const snapshot = await this.getLatestArtifactSnapshot(artifactId);
    if (!snapshot) {
      throw new Error('Не удалось прочитать сохраненный артефакт');
    }

    return snapshot;
  }

  async addArtifactExport(input: {
    versionId: number;
    format: ArtifactExportFormat;
    content?: string;
    location?: string;
  }): Promise<{ id: number }> {
    const hasContent = Boolean(input.content?.trim());
    const hasLocation = Boolean(input.location?.trim());

    if (!hasContent && !hasLocation) {
      throw new Error(
        'Экспорт должен содержать данные или ссылку на хранилище',
      );
    }

    const version = await this.get<{ id: number }>(
      'SELECT id FROM artifact_versions WHERE id = ?',
      [input.versionId],
    );

    if (!version) {
      throw new Error(`Версия артефакта ${input.versionId} не найдена`);
    }

    await this.run(
      `INSERT INTO artifact_exports (artifact_version_id, format, content, location)
       VALUES (?, ?, ?, ?)`,
      [
        input.versionId,
        input.format,
        hasContent ? input.content!.trim() : null,
        hasLocation ? input.location!.trim() : null,
      ],
    );

    const row = await this.get<{ id: number }>(
      'SELECT id FROM artifact_exports WHERE id = last_insert_rowid()',
    );

    if (!row) {
      throw new Error('Не удалось создать экспорт артефакта');
    }

    return row;
  }

  async listLatestArtifacts(): Promise<ArtifactSnapshot[]> {
    const rows = await this.all<{
      artifactId: number;
      title: string;
      kind: ArtifactKind;
      category: string;
      version: number;
      format: ArtifactFormat;
      content: string;
      renderUrl: string | null;
      createdAt: string;
    }>(
      `
      SELECT
        a.id as artifactId,
        a.title as title,
        a.kind as kind,
        a.category as category,
        v.version as version,
        v.format as format,
        v.content as content,
        v.render_url as renderUrl,
        v.created_at as createdAt
      FROM artifacts a
      INNER JOIN artifact_versions v ON v.id = (
        SELECT v2.id
        FROM artifact_versions v2
        WHERE v2.artifact_id = a.id
        ORDER BY v2.version DESC, v2.created_at DESC
        LIMIT 1
      )
      ORDER BY v.created_at DESC, a.id DESC
      `,
    );

    return rows.map((row) => ({
      artifactId: row.artifactId,
      title: row.title,
      kind: row.kind,
      category: this.toExternalCategory(row.category),
      version: row.version,
      format: row.format,
      content: row.content,
      renderUrl: row.renderUrl,
      createdAt: row.createdAt,
    }));
  }

  private normalizeCategory(category: ArtifactCategory): ArtifactCategory {
    const map: Record<string, ArtifactCategory> = {
      use_case_diagram: ArtifactCategory.UseCaseDiagram,
      USE_CASE_DIAGRAM: ArtifactCategory.UseCaseDiagram,
      er_diagram: ArtifactCategory.ErDiagram,
      entity_diagram: ArtifactCategory.ErDiagram,
      ENTITY_DIAGRAM: ArtifactCategory.ErDiagram,
      user_scenario: ArtifactCategory.UserScenario,
      USER_SCENARIO: ArtifactCategory.UserScenario,
      functional_requirement: ArtifactCategory.FunctionalRequirement,
      FUNCTIONAL_REQUIREMENTS: ArtifactCategory.FunctionalRequirement,
      non_functional_requirement: ArtifactCategory.NonFunctionalRequirement,
      NON_FUNCTIONAL_REQUIREMENTS: ArtifactCategory.NonFunctionalRequirement,
      acceptance_criteria: ArtifactCategory.AcceptanceCriteria,
      ACCEPTANCE_CRITERIA: ArtifactCategory.AcceptanceCriteria,
    };

    const normalized = map[category];
    if (!normalized) {
      throw new Error(`Неподдерживаемая категория артефакта: ${category}`);
    }
    return normalized;
  }

  private toExternalCategory(category: string): ArtifactCategory {
    const map: Record<string, ArtifactCategory> = {
      use_case_diagram: ArtifactCategory.UseCaseDiagramUpper,
      er_diagram: ArtifactCategory.EntityDiagramUpper,
      entity_diagram: ArtifactCategory.EntityDiagramUpper,
      user_scenario: ArtifactCategory.UserScenarioUpper,
      functional_requirement: ArtifactCategory.FunctionalRequirementsUpper,
      non_functional_requirement:
        ArtifactCategory.NonFunctionalRequirementsUpper,
      acceptance_criteria: ArtifactCategory.AcceptanceCriteriaUpper,
    };
    return map[category] ?? (category as ArtifactCategory);
  }

  private async upsertArtifactRecord(input: {
    id?: number;
    title: string;
    kind: ArtifactKind;
    category: ArtifactCategory;
  }): Promise<number> {
    if (input.id) {
      const existing = await this.get<{ id: number }>(
        'SELECT id FROM artifacts WHERE id = ?',
        [input.id],
      );

      if (!existing) {
        throw new Error(`Артефакт ${input.id} не найден`);
      }

      await this.run(
        'UPDATE artifacts SET title = ?, kind = ?, category = ? WHERE id = ?',
        [input.title, input.kind, input.category, input.id],
      );
      return input.id;
    }

    await this.run(
      'INSERT INTO artifacts (title, kind, category) VALUES (?, ?, ?)',
      [input.title, input.kind, input.category],
    );

    const row = await this.get<{ id: number }>(
      'SELECT id FROM artifacts WHERE id = last_insert_rowid()',
    );

    if (!row) {
      throw new Error('Не удалось создать запись артефакта');
    }

    return row.id;
  }

  private async attachArtifactSources(
    artifactId: number,
    taskIds?: number[],
    messageIds?: number[],
  ): Promise<void> {
    const uniqueTasks = Array.from(
      new Set(
        (taskIds ?? []).filter(
          (taskId) => Number.isFinite(taskId) && Number(taskId) > 0,
        ),
      ),
    );
    const uniqueMessages = Array.from(
      new Set(
        (messageIds ?? []).filter(
          (messageId) => Number.isFinite(messageId) && Number(messageId) > 0,
        ),
      ),
    );

    if (uniqueTasks.length) {
      const existing = await this.getTasksByIds(uniqueTasks);
      const missing = uniqueTasks.filter(
        (taskId) => !existing.find((item) => item.id === taskId),
      );
      if (missing.length) {
        throw new Error(`Задачи с такими ID не найдены: ${missing.join(', ')}`);
      }

      for (const taskId of uniqueTasks) {
        await this.run(
          `INSERT OR IGNORE INTO artifact_sources (artifact_id, source_type, source_id, description)
           VALUES (?, 'task', ?, NULL)`,
          [artifactId, taskId],
        );
      }
    }

    for (const messageId of uniqueMessages) {
      await this.run(
        `INSERT OR IGNORE INTO artifact_sources (artifact_id, source_type, source_id, description)
         VALUES (?, 'message', ?, NULL)`,
        [artifactId, messageId],
      );
    }

    if (!uniqueTasks.length && !uniqueMessages.length) {
      const existingSources = await this.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM artifact_sources WHERE artifact_id = ?',
        [artifactId],
      );

      if (!existingSources?.count) {
        await this.run(
          `INSERT INTO artifact_sources (artifact_id, source_type, source_id, description)
           VALUES (?, 'manual', NULL, 'Сохранено без явной ссылки на источник')`,
          [artifactId],
        );
      }
    }
  }

  private async getLatestArtifactSnapshot(
    artifactId: number,
  ): Promise<ArtifactSnapshot | undefined> {
    const row = await this.get<{
      artifactId: number;
      title: string;
      kind: ArtifactKind;
      category: string;
      version: number;
      format: ArtifactFormat;
      content: string;
      renderUrl: string | null;
      createdAt: string;
    }>(
      `
      SELECT
        a.id as artifactId,
        a.title as title,
        a.kind as kind,
        a.category as category,
        v.version as version,
        v.format as format,
        v.content as content,
        v.render_url as renderUrl,
        v.created_at as createdAt
      FROM artifacts a
      INNER JOIN artifact_versions v ON v.id = (
        SELECT v2.id
        FROM artifact_versions v2
        WHERE v2.artifact_id = a.id
        ORDER BY v2.version DESC, v2.created_at DESC
        LIMIT 1
      )
      WHERE a.id = ?
      `,
      [artifactId],
    );

    if (!row) return undefined;

    return {
      artifactId: row.artifactId,
      title: row.title,
      kind: row.kind,
      category: this.toExternalCategory(row.category),
      version: row.version,
      format: row.format,
      content: row.content,
      renderUrl: row.renderUrl,
      createdAt: row.createdAt,
    };
  }

  async deleteTask(id: number): Promise<void> {
    const existing = await this.get<{ id: number }>(
      'SELECT id FROM tasks WHERE id = ?',
      [id],
    );

    if (!existing) {
      throw new Error('Задача не найдена');
    }

    await this.run(
      'DELETE FROM task_links WHERE parent_id = ? OR child_id = ?',
      [id, id],
    );
    await this.run('DELETE FROM tasks WHERE id = ?', [id]);
  }

  private run(sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('База данных не инициализирована'));
        return;
      }

      this.db.run(sql, params, (err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  private all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('База данных не инициализирована'));
        return;
      }

      this.db.all<T>(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  private get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('База данных не инициализирована'));
        return;
      }

      this.db.get<T>(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (!this.db) {
        resolve();
        return;
      }

      this.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}
