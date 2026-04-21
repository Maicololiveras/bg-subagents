#!/usr/bin/env node
/**
 * schema-publish.mjs
 *
 * Converts PolicySchema (from @maicolextic/bg-subagents-protocol) into a
 * JSON Schema draft-07 document and writes it to docs/schema/policy-v1.json.
 *
 * Decisions:
 *   - Publishes the PROTOCOL-level PolicySchema (clean contract), NOT the
 *     core-level FilePolicySchema wrapper (which is an internal loader detail).
 *   - Uses zodToJsonSchema with { target: "jsonSchema7" } for clean draft-07 output.
 *   - $id is a placeholder URL; resolves to a real URL after GH Pages is enabled.
 */

import { createRequire } from "module";
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// Resolve the built dist of the protocol package from workspace link
const protocolDistPath = resolve(
  repoRoot,
  "packages/protocol/dist/schemas.js"
);
const zodToJsonSchemaPath = resolve(
  repoRoot,
  "node_modules/zod-to-json-schema/dist/esm/index.js"
);

try {
  // Dynamic imports to support ESM — must use file:// URLs on Windows
  const { PolicySchema } = await import(
    new URL(`file:///${protocolDistPath.replace(/\\/g, "/")}`)
  );
  const { zodToJsonSchema } = await import(
    new URL(`file:///${zodToJsonSchemaPath.replace(/\\/g, "/")}`)
  );

  const rawSchema = zodToJsonSchema(PolicySchema, {
    name: "PolicyV1",
    target: "jsonSchema7",
    $refStrategy: "none",
  });

  // zodToJsonSchema wraps in { definitions: { PolicyV1: ... }, $ref: "#/definitions/PolicyV1" }
  // Unwrap to get the direct schema object
  const schemaBody =
    rawSchema.definitions?.PolicyV1 ?? rawSchema;

  const output = {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://maicololiveras.github.io/bg-subagents/schema/policy-v1.json",
    title: "PolicyV1",
    description:
      "Runtime policy schema for @maicolextic/bg-subagents-protocol. Controls default modes, security limits, history, and telemetry.",
    ...schemaBody,
  };

  const outDir = resolve(repoRoot, "docs/schema");
  mkdirSync(outDir, { recursive: true });

  const outPath = resolve(outDir, "policy-v1.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");

  console.log(`[schema-publish] Written: ${outPath}`);
  process.exit(0);
} catch (err) {
  console.error("[schema-publish] ERROR:", err?.message ?? err);
  if (err?.code === "ERR_MODULE_NOT_FOUND") {
    console.error(
      "[schema-publish] Hint: run `pnpm -r build` before this script."
    );
  }
  process.exit(1);
}
