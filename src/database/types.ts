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
