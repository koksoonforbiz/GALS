/** Debounced sync of the Playground's editor contents during the
 *  implementation stage, so `check-match`/session resume always see the
 *  student's current code even before they click Run. */
export interface SubmitCodeDto {
  code: string;
}
