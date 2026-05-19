export type Accessor<T> = () => T;
export type Setter<T> = (value: T | ((previous: T) => T)) => T;

export function createSignal<T>(initial: T): [Accessor<T>, Setter<T>] {
  let current = initial;
  const accessor: Accessor<T> = () => current;
  const setter: Setter<T> = (value) => {
    current = typeof value === "function" ? (value as (previous: T) => T)(current) : value;
    return current;
  };
  return [accessor, setter];
}
