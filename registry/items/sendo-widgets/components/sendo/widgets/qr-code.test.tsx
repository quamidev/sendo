// @vitest-environment jsdom
/**
 * Protocol-level isolation test for the QR a printed sign carries (AC-WG-2). A phone camera is
 * the only real consumer, so the rendered SVG is rasterised and decoded with an independent
 * decoder (`jsqr`, dev-only), and the format bits are read back from the module grid.
 *
 * Ways it could fail (one test each):
 * 1. The SVG drops, shifts or merges modules (run-length path bug), so a phone reads another URL or
 *    nothing: the decoded text must be exactly the link, accents and emoji percent-encoded.
 * 2. The quiet zone is narrower than 4 modules, so many scanners can't find the code.
 * 3. Error correction is below Q (L or M), so a scuffed or dirty printed sign stops scanning.
 * 4. The code is not dark-on-light (transparent background, currentColor in dark mode), which
 *    phone cameras can't read.
 * 5. The downloaded SVG is not the code on screen (stale value, other matrix).
 * 6. A message too long for any QR version throws and takes the screen down instead of saying so.
 *
 * Not covered here: the PNG download (jsdom has no canvas); it draws the same matrix and is
 * checked in the browser QA.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import jsQR from "jsqr";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeQr, QR_QUIET_ZONE, SendoQrCode } from "./qr-code";
import { defaultWidgetsStrings } from "./strings";

const LINK =
  "https://wa.me/50255551234?text=" +
  encodeURIComponent("Hola, quiero información de la torre B 🏢 [#garita-norte]");

const LEVEL_BITS = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 } as const;
type Level = keyof typeof LEVEL_BITS;

/** The 15-bit format word for a level and mask (ISO/IEC 18004 BCH(15,5), XOR 0x5412). */
function formatWord(level: Level, mask: number): number {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let rem = data << 10;
  for (let bit = 14; bit >= 10; bit--) {
    if ((rem >> bit) & 1) rem ^= 0x537 << (bit - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

/** Error-correction level from the format bits next to the top-left finder pattern. */
function levelOf(modules: boolean[][]): Level | null {
  const at = (row: number, col: number) => (modules[row]?.[col] ? 1 : 0);
  let word = 0;
  for (let col = 0; col <= 8; col++) if (col !== 6) word = (word << 1) | at(8, col);
  for (let row = 7; row >= 0; row--) if (row !== 6) word = (word << 1) | at(row, 8);
  for (const level of Object.keys(LEVEL_BITS) as Level[]) {
    for (let mask = 0; mask < 8; mask++) if (formatWord(level, mask) === word) return level;
  }
  return null;
}

interface Rendered {
  /** Modules including the quiet zone (`size` × `size`). */
  grid: boolean[][];
  size: number;
  background: string | null;
  foreground: string | null;
}

/** Reads the `<svg>`: viewBox size, background rect and the run-length path. */
function readSvg(svg: Element): Rendered {
  const [, , width, height] = (svg.getAttribute("viewBox") ?? "").split(" ").map(Number);
  if (!width || width !== height) throw new Error("viewBox is not square");
  const rect = svg.querySelector("rect");
  const path = svg.querySelector("path");
  const grid = Array.from({ length: width }, () => Array.from({ length: width }, () => false));
  for (const run of (path?.getAttribute("d") ?? "").matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
    const [x, y, w, back] = run.slice(1).map(Number) as [number, number, number, number];
    if (w !== back) throw new Error(`open run at ${String(x)},${String(y)}`);
    for (let dx = 0; dx < w; dx++) {
      const row = grid[y];
      if (!row || x + dx >= width) throw new Error("module outside the viewBox");
      row[x + dx] = true;
    }
  }
  const fullBackground =
    rect !== null &&
    Number(rect.getAttribute("width")) === width &&
    Number(rect.getAttribute("height")) === width;
  return {
    grid,
    size: width,
    background: fullBackground ? rect.getAttribute("fill") : null,
    foreground: path?.getAttribute("fill") ?? null,
  };
}

/** Rasterises the grid (dark = black) at `scale` px per module and decodes it with jsQR. */
function decode({ grid, size }: Rendered, scale = 4): string | null {
  const pixels = size * scale;
  const data = new Uint8ClampedArray(pixels * pixels * 4);
  for (let py = 0; py < pixels; py++) {
    for (let px = 0; px < pixels; px++) {
      const dark = grid[Math.floor(py / scale)]?.[Math.floor(px / scale)] ?? false;
      const offset = (py * pixels + px) * 4;
      const value = dark ? 0 : 255;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return jsQR(data, pixels, pixels)?.data ?? null;
}

function modulesOf(rendered: Rendered): boolean[][] {
  return rendered.grid
    .slice(QR_QUIET_ZONE, rendered.size - QR_QUIET_ZONE)
    .map((row) => row.slice(QR_QUIET_ZONE, rendered.size - QR_QUIET_ZONE));
}

function renderQr(level?: "Q" | "H" | "auto") {
  render(<SendoQrCode value={LINK} label="QR garita" level={level} fileName="whatsapp-garita" />);
  return readSvg(screen.getByRole("img", { name: "QR garita" }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<SendoQrCode> (AC-WG-2)", () => {
  it("1. the rendered SVG decodes to exactly the link, module for module", () => {
    const rendered = renderQr();
    // Error correction would hide a few misplaced modules from the decoder: compare them too.
    expect(modulesOf(rendered)).toEqual(encodeQr(LINK, "H"));
    expect(decode(rendered)).toBe(LINK);
  });

  it("2. keeps a 4-module quiet zone on every side", () => {
    const rendered = renderQr();
    const border = rendered.grid.flatMap((row, y) =>
      row.filter(
        (_, x) =>
          y < QR_QUIET_ZONE ||
          x < QR_QUIET_ZONE ||
          y >= rendered.size - QR_QUIET_ZONE ||
          x >= rendered.size - QR_QUIET_ZONE,
      ),
    );
    expect(border.length).toBeGreaterThan(0);
    expect(border.every((dark) => !dark)).toBe(true);
    // The code itself starts right after the quiet zone (top-left finder pattern corner).
    expect(rendered.grid[QR_QUIET_ZONE]?.[QR_QUIET_ZONE]).toBe(true);
  });

  it("3. encodes with error correction H by default and Q when asked, never L or M", () => {
    expect(levelOf(modulesOf(renderQr()))).toBe("H");
    document.body.innerHTML = "";
    expect(levelOf(modulesOf(renderQr("Q")))).toBe("Q");
    // The reader tells levels apart (guards the check above).
    expect(levelOf(encodeQr(LINK, "Q") ?? [])).toBe("Q");
    // A long message makes the default fall back to Q (still enough for a printed sign), not lower.
    document.body.innerHTML = "";
    const long = `https://wa.me/50255551234?text=${encodeURIComponent("Hola, quiero información ".repeat(12))}`;
    render(<SendoQrCode value={long} label="QR largo" />);
    const dense = readSvg(screen.getByRole("img", { name: "QR largo" }));
    expect(levelOf(modulesOf(dense))).toBe("Q");
    expect(decode(dense)).toBe(long);
  });

  it("4. draws black modules on a white background that covers the whole code", () => {
    const rendered = renderQr();
    expect(rendered.background?.toLowerCase()).toBe("#ffffff");
    expect(rendered.foreground?.toLowerCase()).toBe("#000000");
  });

  it("5. the SVG download is the code on screen", async () => {
    const blobs: Blob[] = [];
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:qr";
      }),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const onScreen = renderQr();

    fireEvent.click(screen.getByRole("button", { name: defaultWidgetsStrings.downloadSvg }));

    const [blob] = blobs;
    expect(blobs).toHaveLength(1);
    expect(blob?.type).toBe("image/svg+xml");
    const doc = new DOMParser().parseFromString((await blob?.text()) ?? "", "image/svg+xml");
    const downloaded = readSvg(doc.documentElement);
    expect(downloaded.grid).toEqual(onScreen.grid);
    expect(decode(downloaded)).toBe(LINK);
    expect(downloaded.background?.toLowerCase()).toBe("#ffffff");
  });

  it("6. a message too long for a QR shows an error instead of throwing", () => {
    const tooLong = `https://wa.me/50255551234?text=${"a".repeat(3000)}`;
    render(<SendoQrCode value={tooLong} label="QR largo" />);

    expect(screen.getByRole("alert")).toHaveTextContent(defaultWidgetsStrings.qrTooLong);
    expect(screen.queryByRole("img")).toBeNull();
  });
});
