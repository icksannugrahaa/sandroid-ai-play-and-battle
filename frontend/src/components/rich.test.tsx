import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RichText } from "./rich";

const answer =
  "Game:\n```html index.html\n<html><head><link rel='stylesheet' href='style.css'></head><body><canvas></canvas><script src='game.js'></script></body></html>\n```\n" +
  "```css style.css\ncanvas{background:#000}\n```\n```javascript game.js\nconsole.log('go')\n```\n";

describe("RichText game auto-run", () => {
  it("does not start the game while the answer is still streaming", () => {
    const { container, getByText } = render(<RichText text={answer} cursor />);
    expect(container.querySelector("iframe[srcdoc]")).toBeNull();
    expect(getByText(/when this answer finishes/i)).toBeTruthy();
  });

  it("auto-runs the merged project, sandboxed without same-origin, once finished", () => {
    const { container } = render(<RichText text={answer} />);
    const frame = container.querySelector("iframe[srcdoc]")!;
    expect(frame).toBeTruthy();
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-modals allow-forms allow-pointer-lock");
    const doc = frame.getAttribute("srcdoc")!;
    expect(doc).toContain("canvas{background:#000}");
    expect(doc).toContain("console.log('go')");
    expect(doc).not.toMatch(/src=['"]game\.js/);
  });

  it("sanitizes markdown prose", () => {
    const { container } = render(<RichText text={'hi <img src=x onerror="alert(1)"> [x](javascript:alert(1)) <script>alert(1)</script>'} />);
    expect(container.querySelector("img, script")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBeNull();
  });
});
