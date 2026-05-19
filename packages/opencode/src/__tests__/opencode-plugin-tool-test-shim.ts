type ChainableSchema = {
  min: (value: number) => ChainableSchema;
  describe: (text: string) => ChainableSchema;
  optional: () => ChainableSchema;
};

function schema(): ChainableSchema {
  const chain: ChainableSchema = {
    min: () => chain,
    describe: () => chain,
    optional: () => chain,
  };
  return chain;
}

export const tool = Object.assign(<T>(definition: T): T => definition, {
  schema: {
    string: schema,
    enum: (_values: readonly string[]) => schema(),
  },
});

export type ToolContext = {
  readonly sessionID?: string;
  readonly abort?: AbortSignal;
};

export type ToolResult = {
  readonly output: string;
  readonly metadata?: Record<string, unknown>;
};
