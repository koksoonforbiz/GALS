export interface QueryStudentRagDto {
  query: string;
  activeSourceIds: string[];
  topK?: number;
}
