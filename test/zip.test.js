import test from "node:test";
import assert from "node:assert/strict";
import { createZip } from "../src/zip.js";

test("creates a zip archive with local and central directory signatures", () => {
  const archive = createZip([
    { name: "来源说明.txt", data: Buffer.from("hello", "utf8") }
  ]);

  assert.equal(archive.subarray(0, 4).toString("hex"), "504b0304");
  assert.ok(archive.includes(Buffer.from("来源说明.txt", "utf8")));
  assert.equal(archive.subarray(archive.length - 22, archive.length - 18).toString("hex"), "504b0506");
});
