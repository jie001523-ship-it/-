const noisePatterns = [
  /adobe/i,
  /illustrator/i,
  /photoshop/i,
  /缺少字体/,
  /字体不可用/,
  /替换字体/,
  /查找字体/,
  /激活字体/,
  /同步字体/,
  /确定/,
  /取消/,
  /关闭/,
  /missing fonts?/i,
  /fonts? are missing/i,
  /replace fonts?/i,
  /find fonts?/i,
  /ok$/i,
  /cancel$/i
];

export function extractFontNames(input) {
  const text = String(input || "")
    .replace(/\r/g, "\n")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[，、;；]/g, "\n");

  const candidates = text
    .split(/\n|(?<=["'])\s+(?=["'])/)
    .map((line) => cleanLine(line))
    .flatMap(splitInlineFonts)
    .map((line) => cleanLine(line))
    .filter(Boolean)
    .filter((line) => !noisePatterns.some((pattern) => pattern.test(line)))
    .filter((line) => /[\p{L}\p{N}]/u.test(line))
    .filter((line) => line.length >= 2 && line.length <= 80);

  return [...new Set(candidates)];
}

function splitInlineFonts(line) {
  const quoted = [...line.matchAll(/["']([^"']{2,80})["']/g)].map((match) => match[1]);
  if (quoted.length) return quoted;

  const withMarkers = line.match(/(?:字体|font)\s*[:：]\s*(.+)$/i);
  if (withMarkers) return [withMarkers[1]];

  return [line];
}

function cleanLine(line) {
  return String(line || "")
    .replace(/^[\s\-•*·:：]+/, "")
    .replace(/[\s,，.。;；:：]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}
