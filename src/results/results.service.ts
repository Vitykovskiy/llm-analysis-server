import { Injectable } from '@nestjs/common';
import {
  ArtifactCategory,
  ArtifactKind,
  ArtifactSnapshot,
  DatabaseService,
} from '../database/database.service';

export type ResultFormat = 'markdown' | 'plantuml';

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
  constructor(private readonly databaseService: DatabaseService) {}

  async list(): Promise<ResultEntry[]> {
    const latest = await this.databaseService.listLatestArtifacts();
    return latest.map((item: ArtifactSnapshot) => ({
      id: item.artifactId,
      title: item.title,
      format: item.format === 'plantuml' ? 'plantuml' : 'markdown',
      content: item.content,
      category: item.category,
      kind: item.kind,
      version: item.version,
      renderUrl: item.renderUrl,
      createdAt: item.createdAt,
    }));
  }
}
