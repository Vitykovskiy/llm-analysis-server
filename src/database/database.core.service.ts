import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Database, verbose } from 'sqlite3';
import { TaskStatus } from '../tasks/tasks.service';
import {
  ArtifactCategory,
  ArtifactExportFormat,
  ArtifactFormat,
  ArtifactKind,
  ArtifactSourceType,
} from './types';

const sqlite3 = verbose();

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
export class DatabaseCoreService implements OnModuleInit, OnModuleDestroy {
  private db?: Database;
  private readonly logger = new Logger(DatabaseCoreService.name);
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
    this.logger.log(`SQLite база: ${this.dbFile}`);
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

  async run(sql: string, params: unknown[] = []): Promise<void> {
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

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
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

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
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
      'Обнаружена таблица tasks со старым набором статусов, выполняем миграцию',
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
}
