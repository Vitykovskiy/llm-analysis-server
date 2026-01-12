import { Injectable } from '@nestjs/common';
import { DatabaseCoreService } from './database.core.service';
import { DatabaseTasksService } from './database-tasks.service';
import {
  ArtifactCategory,
  ArtifactExportFormat,
  ArtifactFormat,
  ArtifactKind,
  ArtifactSnapshot,
  ArtifactSourceType,
} from './types';

@Injectable()
export class DatabaseArtifactsService {
  constructor(
    private readonly db: DatabaseCoreService,
    private readonly tasksService: DatabaseTasksService,
  ) {}

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

    const nextVersion = await this.db.get<{ next: number }>(
      'SELECT COALESCE(MAX(version), 0) + 1 as next FROM artifact_versions WHERE artifact_id = ?',
      [artifactId],
    );

    await this.db.run(
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
      throw new Error('Не удалось получить сохраненный артефакт');
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
      throw new Error('Нужно указать содержимое или location');
    }

    const version = await this.db.get<{ id: number }>(
      'SELECT id FROM artifact_versions WHERE id = ?',
      [input.versionId],
    );

    if (!version) {
      throw new Error(`Версия артефакта ${input.versionId} не найдена`);
    }

    await this.db.run(
      `INSERT INTO artifact_exports (artifact_version_id, format, content, location)
       VALUES (?, ?, ?, ?)`,
      [
        input.versionId,
        input.format,
        hasContent ? input.content!.trim() : null,
        hasLocation ? input.location!.trim() : null,
      ],
    );

    const row = await this.db.get<{ id: number }>(
      'SELECT id FROM artifact_exports WHERE id = last_insert_rowid()',
    );

    if (!row) {
      throw new Error('Не удалось сохранить экспорт артефакта');
    }

    return row;
  }

  async listLatestArtifacts(): Promise<ArtifactSnapshot[]> {
    const rows = await this.db.all<{
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
      throw new Error(`Неизвестная категория артефакта: ${category}`);
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
      const existing = await this.db.get<{ id: number }>(
        'SELECT id FROM artifacts WHERE id = ?',
        [input.id],
      );

      if (!existing) {
        throw new Error(`Артефакт ${input.id} не найден`);
      }

      await this.db.run(
        'UPDATE artifacts SET title = ?, kind = ?, category = ? WHERE id = ?',
        [input.title, input.kind, input.category, input.id],
      );
      return input.id;
    }

    await this.db.run(
      'INSERT INTO artifacts (title, kind, category) VALUES (?, ?, ?)',
      [input.title, input.kind, input.category],
    );

    const row = await this.db.get<{ id: number }>(
      'SELECT id FROM artifacts WHERE id = last_insert_rowid()',
    );

    if (!row) {
      throw new Error('Не удалось сохранить артефакт');
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
      const existing = await this.tasksService.getTasksByIds(uniqueTasks);
      const missing = uniqueTasks.filter(
        (taskId) => !existing.find((item) => item.id === taskId),
      );
      if (missing.length) {
        throw new Error(`Задачи с такими ID не найдены: ${missing.join(', ')}`);
      }

      for (const taskId of uniqueTasks) {
        await this.db.run(
          `INSERT OR IGNORE INTO artifact_sources (artifact_id, source_type, source_id, description)
           VALUES (?, '${ArtifactSourceType.Task}', ?, NULL)`,
          [artifactId, taskId],
        );
      }
    }

    for (const messageId of uniqueMessages) {
      await this.db.run(
        `INSERT OR IGNORE INTO artifact_sources (artifact_id, source_type, source_id, description)
         VALUES (?, '${ArtifactSourceType.Message}', ?, NULL)`,
        [artifactId, messageId],
      );
    }

    if (!uniqueTasks.length && !uniqueMessages.length) {
      const existingSources = await this.db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM artifact_sources WHERE artifact_id = ?',
        [artifactId],
      );

      if (!existingSources?.count) {
        await this.db.run(
          `INSERT INTO artifact_sources (artifact_id, source_type, source_id, description)
           VALUES (?, '${ArtifactSourceType.Manual}', NULL, 'Добавлено вручную')`,
          [artifactId],
        );
      }
    }
  }

  private async getLatestArtifactSnapshot(
    artifactId: number,
  ): Promise<ArtifactSnapshot | undefined> {
    const row = await this.db.get<{
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
}
