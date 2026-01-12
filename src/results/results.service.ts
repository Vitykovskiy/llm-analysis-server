import { Injectable } from '@nestjs/common';
import { DatabaseArtifactsService } from '../database/database-artifacts.service';
import {
  ArtifactCategory,
  ArtifactFormat,
  ArtifactKind,
  ArtifactSnapshot,
} from '../database/types';

export enum ResultFormat {
  Markdown = 'markdown',
  Plantuml = 'plantuml',
}

export interface ResultEntry {
  id: number;
  title: string;
  format: ResultFormat;
  content: string;
  category: ArtifactCategory;
  kind: ArtifactKind;
  version: number;
  renderUrl?: string | null;
  createdAt: string;
}

@Injectable()
export class ResultsService {
  constructor(private readonly databaseService: DatabaseArtifactsService) {}

  async list(): Promise<ResultEntry[]> {
    const latest = await this.databaseService.listLatestArtifacts();
    return latest.map((item: ArtifactSnapshot) => ({
      id: item.artifactId,
      title: item.title,
      format:
        item.format === ArtifactFormat.Plantuml
          ? ResultFormat.Plantuml
          : ResultFormat.Markdown,
      content: item.content,
      category: item.category,
      kind: item.kind,
      version: item.version,
      renderUrl: item.renderUrl,
      createdAt: item.createdAt,
    }));
  }
}
