import { describe, expect, it } from "vitest";

import { classifyUrl, codeArtifact, extractArtifacts, parseCsv, parseSegments, safeToOpenInline } from "./artifacts";

describe("parseSegments", () => {
  it("splits prose and code blocks with filenames and kinds", () => {
    const text = "Here:\n```python main.py\nprint(1)\n```\nand page\n```html\n<h1>x</h1>\n```\ndone";
    const segs = parseSegments(text);
    expect(segs.map((s) => s.type)).toEqual(["text", "code", "text", "code", "text"]);
    const [, py, , html] = segs;
    expect(py).toMatchObject({ type: "code", closed: true, artifact: { kind: "code", name: "main.py", lang: "python", content: "print(1)\n" } });
    expect(html).toMatchObject({ type: "code", artifact: { kind: "html", name: "snippet-2.html" } });
  });

  it("treats an unclosed fence as code while streaming", () => {
    const segs = parseSegments("intro\n```js\nconst a = 1");
    expect(segs[1]).toMatchObject({ type: "code", closed: false, artifact: { ext: "js", content: "const a = 1" } });
  });

  it("detects untagged html/svg and csv/json kinds", () => {
    expect(codeArtifact("", "<!DOCTYPE html><p>", 0).kind).toBe("html");
    expect(codeArtifact("xml", "<svg viewBox='0 0 1 1'/>", 0).kind).toBe("svg");
    expect(codeArtifact("csv", "a,b", 0).kind).toBe("csv");
    expect(codeArtifact("json", "{}", 0).kind).toBe("json");
    expect(codeArtifact("rust", "fn main(){}", 0)).toMatchObject({ kind: "code", ext: "rs" });
  });
});

describe("classifyUrl / extractArtifacts", () => {
  it("classifies by extension and data-url mime", () => {
    const k = (u: string) => classifyUrl(u)?.kind ?? null;
    expect(k("https://x.test/a/photo.JPG")).toBe("image");
    expect(k("https://x.test/v.mp4?sig=1")).toBe("video");
    expect(k("https://x.test/s.mp3")).toBe("audio");
    expect(k("https://x.test/report.pdf")).toBe("pdf");
    expect(k("https://x.test/deck.pptx")).toBe("file");
    expect(k("https://x.test/script.py")).toBe("text");
    expect(k("https://x.test/data.csv")).toBe("csv");
    expect(k("https://x.test/about")).toBeNull(); // plain link
    expect(k("http://x.test/a.png")).toBeNull(); // https only
    expect(k("data:audio/wav;base64,AAAA")).toBe("audio");
    expect(k("data:application/pdf;base64,AAAA")).toBe("pdf");
  });

  it("collects out-of-band media and links once", () => {
    const segs = parseSegments("See https://x.test/a.png, and https://x.test/a.png. Also ```\nhttps://x.test/in-code.png\n```");
    const arts = extractArtifacts(segs, ["data:image/png;base64,QQ=="], ["data:audio/wav;base64,UklG"]);
    expect(arts.map((a) => a.kind)).toEqual(["image", "audio", "image"]);
    expect(arts[2]?.src).toBe("https://x.test/a.png");
  });
});

describe("parseCsv", () => {
  it("handles quotes, escaped quotes and CRLF", () => {
    expect(parseCsv('name,note\r\n"Doe, J","said ""hi"""\nx,y')).toEqual([
      ["name", "note"],
      ["Doe, J", 'said "hi"'],
      ["x", "y"],
    ]);
  });
});

describe("safeToOpenInline", () => {
  it("never opens html or svg in our origin", () => {
    expect(safeToOpenInline(codeArtifact("html", "<p>", 0))).toBe(false);
    expect(safeToOpenInline(classifyUrl("data:image/svg+xml;base64,AA")!)).toBe(false);
    expect(safeToOpenInline(classifyUrl("data:image/png;base64,AA")!)).toBe(true);
  });
});
