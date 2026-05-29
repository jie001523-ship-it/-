import test from "node:test";
import assert from "node:assert/strict";
import { extractFontNames } from "../src/fontText.js";

test("extracts font names from Illustrator-style missing font text", () => {
  const input = `
    Adobe Illustrator
    缺少字体
    方正兰亭黑
    思源黑体
    Helvetica Neue
    确定
    取消
  `;

  assert.deepEqual(extractFontNames(input), ["方正兰亭黑", "思源黑体", "Helvetica Neue"]);
});

test("splits pasted batch input and removes duplicates", () => {
  const input = "方正兰亭黑，思源黑体\nDIN; DIN\nfont: Helvetica Neue";

  assert.deepEqual(extractFontNames(input), ["方正兰亭黑", "思源黑体", "DIN", "Helvetica Neue"]);
});
