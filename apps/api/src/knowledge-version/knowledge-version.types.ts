// ─── Snapshot Data Types ────────────────────────────────

export interface KcSnapshot {
  id: string;
  name: string;
  description: string | null;
  status: string; // PROPOSED | APPROVED | ARCHIVED
  confidenceLevel: string;
  createdBy: string;
  relatedToKCId: string | null;
  evidence: unknown;
  pageIds: string[];
}

export interface EdgeSnapshot {
  id: string;
  fromKcId: string;
  toKcId: string;
  relationship: string;
  weight: number;
  createdBy: string;
}

export interface MappingSnapshot {
  id: string;
  kcId: string;
  pageId: string;
  strength: string;
  blockIds: string[];
  createdBy: string;
}

// ─── Version Change Types ───────────────────────────────

export type KnowledgeChangeType =
  | 'KC_APPROVE'
  | 'KC_EDIT'
  | 'KC_MERGE'
  | 'KC_ARCHIVE'
  | 'KC_DELETE'
  | 'EDGE_ADD'
  | 'EDGE_UPDATE'
  | 'EDGE_DELETE'
  | 'EDGE_GENERATE'
  | 'MAPPING_ADD'
  | 'MAPPING_UPDATE'
  | 'MAPPING_DELETE'
  | 'MAPPING_AUTO_GENERATE'
  | 'RESTORE';

// ─── Diff Output ────────────────────────────────────────

export interface VersionDiff {
  kcs: {
    added: KcSnapshot[];
    removed: KcSnapshot[];
    modified: Array<{
      id: string;
      name: string;
      changes: Array<{ field: string; from: unknown; to: unknown }>;
    }>;
  };
  edges: {
    added: EdgeSnapshot[];
    removed: EdgeSnapshot[];
    modified: Array<{
      id: string;
      changes: Array<{ field: string; from: unknown; to: unknown }>;
    }>;
  };
  mappings: {
    added: MappingSnapshot[];
    removed: MappingSnapshot[];
    modified: Array<{
      id: string;
      changes: Array<{ field: string; from: unknown; to: unknown }>;
    }>;
  };
}

export interface VersionSummary {
  id: string;
  version: number;
  changeSummary: string;
  changeType: string;
  source: string;
  authorId: string | null;
  createdAt: string;
  stats: {
    kcCount: number;
    edgeCount: number;
    mappingCount: number;
  };
}
