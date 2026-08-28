/** Student-authored tree edits — no LLM call, pure sessionData mutation.
 *  "Split" from the paper is just adding a substep under an existing node,
 *  so it's expressed as `add` with `parentId` set to the node being split
 *  rather than a distinct action. */
export type MutateNodeDto =
  | { action: 'add'; parentId: string | null; content: string }
  | { action: 'edit'; nodeId: string; content: string }
  | { action: 'delete'; nodeId: string }
  | { action: 'reorder'; nodeId: string; direction: 'up' | 'down' };
