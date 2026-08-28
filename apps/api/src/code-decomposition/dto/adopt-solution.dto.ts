/** Persist a previously-previewed "Show Complete Tree/Solution" reveal
 *  as the student's actual tree/code — used when they choose "Accept &
 *  Move to Implementation" (formation) or "Use This Solution"
 *  (implementation) directly from the preview, instead of manually
 *  recreating what was already shown to them. */
export interface AdoptSolutionDto {
  nodes?: Array<{ id: string; parentId: string | null; order: number; content: string }>;
  code?: string;
}
