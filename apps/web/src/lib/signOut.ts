/**
 * Ask the app shell to sign the student out through the normal flow
 * (Layout: stop recording, then the exit mood survey, then logout), from a
 * page that has no access to that handler.
 */
export const REQUEST_SIGN_OUT_EVENT = 'gals:request-sign-out';

export function requestSignOut(): void {
  window.dispatchEvent(new Event(REQUEST_SIGN_OUT_EVENT));
}
