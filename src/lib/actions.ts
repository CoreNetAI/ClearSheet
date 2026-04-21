// Shared result shape for server actions invoked from client components.
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export function actionError(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export function actionOk<T>(data?: T): { ok: true; data?: T } {
  return { ok: true, data };
}
