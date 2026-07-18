import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowPath = new URL(
  "../.github/workflows/run-configured-pipeline.yml",
  import.meta.url,
);

test("keeps configured pipeline details protected and discards command output", () => {
  const workflow = readFileSync(workflowPath, "utf8");

  assert.match(workflow, /on:\s*\n\s+workflow_dispatch:\s*\n/);
  assert.match(workflow, /environment: configured-pipeline/);
  assert.match(workflow, /repository: \$\{\{ secrets\.KAIJU_TARGET_REPOSITORY \}\}/);
  assert.match(workflow, /ssh-key: \$\{\{ secrets\.KAIJU_TARGET_SSH_KEY \}\}/);
  assert.match(workflow, /DATABASE_URL: \$\{\{ secrets\.KAIJU_DATASTORE_URL \}\}/);
  assert.match(workflow, /PIPELINE_COMMAND: \$\{\{ secrets\.KAIJU_PIPELINE_COMMAND \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /> "\$dependency_log" 2>&1/);
  assert.match(workflow, /> "\$pipeline_log" 2>&1/);
  assert.match(workflow, /trap 'rm -f "\$dependency_log" "\$pipeline_log"' EXIT/);

  assert.doesNotMatch(workflow, /repository:\s+[\w.-]+\/[\w.-]+/);
  assert.doesNotMatch(workflow, /https?:\/\//);
  assert.doesNotMatch(workflow, /pull_request:|schedule:/);
  assert.doesNotMatch(workflow, /upload-artifact|\btee\b|\bcat\s+.*\.log\b/i);
});
