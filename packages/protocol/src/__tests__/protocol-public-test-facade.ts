export type TaskId = string & { readonly __brand: "TaskId" };

export function unsafeTaskId(raw: string): TaskId {
  return raw as TaskId;
}
