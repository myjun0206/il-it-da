import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { reembedApprovedManuals } from "../../../lib/rag/manual-indexing/reembed-approved-manuals.ts";

describe("reembedApprovedManuals", () => {
  test("indexes approved manuals only, skipping draft ones (no embedding call for draft)", async () => {
    const indexed: string[] = [];
    const indexManual = async (manualId: string) => {
      indexed.push(manualId);
    };

    await reembedApprovedManuals(
      [
        { id: "approved-1", status: "approved" },
        { id: "draft-1", status: "draft" },
        { id: "approved-2", status: "approved" },
      ],
      indexManual,
    );

    assert.deepEqual(indexed, ["approved-1", "approved-2"]);
  });

  test("continues indexing the rest of the batch after one manual's embedding fails", async () => {
    const attempted: string[] = [];
    const indexManual = async (manualId: string) => {
      attempted.push(manualId);
      if (manualId === "boom") {
        throw new Error("OpenAI request failed");
      }
    };

    await assert.doesNotReject(() =>
      reembedApprovedManuals(
        [
          { id: "ok-1", status: "approved" },
          { id: "boom", status: "approved" },
          { id: "ok-2", status: "approved" },
        ],
        indexManual,
      ),
    );

    assert.deepEqual(attempted, ["ok-1", "boom", "ok-2"]);
  });

  test("reports embedding failures through the safe logger without leaking the raw error", async () => {
    const secretMessage = "connection string postgres://user:pass@host/db leaked here";
    const logged: Array<[string, unknown]> = [];

    await reembedApprovedManuals(
      [{ id: "manual-1", status: "approved" }],
      async () => {
        throw new Error(secretMessage);
      },
      (code, error) => {
        logged.push([code, error]);
      },
    );

    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], "MANUAL_EMBEDDING_FAILED");
    // The helper only forwards the raw error to the caller-supplied logger; it never
    // formats it into a string itself, so nothing here should ever leak the secret.
    assert.equal(JSON.stringify(logged).includes(secretMessage), false);
  });

  test("does not print raw errors or UUIDs through the default safe logger", async () => {
    const secretManualId = "11111111-1111-1111-8111-111111111111";
    const originalConsoleError = console.error;
    const printed: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      printed.push(args);
    };

    try {
      await reembedApprovedManuals([{ id: secretManualId, status: "approved" }], async () => {
        throw new Error(`failed for manual ${secretManualId}`);
      });
    } finally {
      console.error = originalConsoleError;
    }

    const serialized = JSON.stringify(printed);
    assert.equal(serialized.includes(secretManualId), false);
    assert.ok(serialized.includes("MANUAL_EMBEDDING_FAILED"));
  });
});
