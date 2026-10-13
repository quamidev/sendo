"use client";

import { useMemo } from "react";
import { Download } from "lucide-react";
import qrcode from "qrcode-generator";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveWidgetsStrings, type WidgetsStrings } from "./strings";
import { pressClass } from "./press";

/** Q restores ~25 % of damaged modules, H ~30 %: both survive a scuffed or dirty printed sign. */
export type QrErrorCorrection = "Q" | "H";

/** White border the QR spec requires around the code (4 modules), included in every export. */
export const QR_QUIET_ZONE = 4;

/**
 * Above this size (version 16, 81 × 81 modules) a code printed a few centimetres wide gets hard to
 * scan: `level="auto"` drops from H to Q there, and the screen suggests a shorter message.
 */
export const QR_DENSE_MODULES = 81;

/** `matrix[row][col]` is `true` for a dark module. */
export type QrMatrix = boolean[][];

/**
 * The module matrix for `value` (encoded as UTF-8 bytes), or `null` when it doesn't fit in a
 * version-40 code at that error-correction level.
 */
export function encodeQr(value: string, level: QrErrorCorrection = "H"): QrMatrix | null {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const qr = qrcode(0, level);
  try {
    qr.addData(binary, "Byte");
    qr.make();
  } catch {
    return null;
  }
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => qr.isDark(row, col)),
  );
}

/** SVG path for the dark modules: one rectangle per horizontal run, offset by the quiet zone. */
export function qrPath(matrix: QrMatrix, margin = QR_QUIET_ZONE): string {
  const parts: string[] = [];
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x += 1;
      parts.push(
        `M${String(start + margin)} ${String(y + margin)}h${String(x - start)}v1h-${String(x - start)}z`,
      );
    }
  });
  return parts.join("");
}

/** A standalone SVG document (dark modules on white, quiet zone included). */
export function qrSvgMarkup(matrix: QrMatrix, pixels = 1024): string {
  const size = matrix.length + QR_QUIET_ZONE * 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(size)} ${String(size)}" width="${String(pixels)}" height="${String(pixels)}" shape-rendering="crispEdges">`,
    `<rect width="${String(size)}" height="${String(size)}" fill="#ffffff"/>`,
    `<path d="${qrPath(matrix)}" fill="#000000"/>`,
    `</svg>`,
  ].join("");
}

/** A PNG of the code, drawn on a canvas in the browser (no external service). */
export function qrPngBlob(matrix: QrMatrix, minPixels = 1024): Promise<Blob> {
  const size = matrix.length + QR_QUIET_ZONE * 2;
  const scale = Math.max(1, Math.ceil(minPixels / size));
  const canvas = document.createElement("canvas");
  canvas.width = size * scale;
  canvas.height = size * scale;
  const context = canvas.getContext("2d");
  if (context === null) return Promise.reject(new Error("Canvas 2D is not available"));
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000000";
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) {
        context.fillRect((x + QR_QUIET_ZONE) * scale, (y + QR_QUIET_ZONE) * scale, scale, scale);
      }
    });
  });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode the PNG"));
    }, "image/png");
  });
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

export interface SendoQrCodeProps {
  /** Usually `link.url` from `sendo.links.create`. */
  value: string;
  /** Accessible name of the image. */
  label: string;
  /** `auto` (default): H, or Q when H would make the code denser than `QR_DENSE_MODULES`. */
  level?: QrErrorCorrection | "auto";
  /** Download file name without extension, e.g. `whatsapp-garita`. */
  fileName?: string;
  /** Hide the PNG / SVG buttons. */
  hideDownloads?: boolean;
  className?: string;
  strings?: Partial<WidgetsStrings>;
}

/**
 * A QR code rendered as SVG (crisp at any size, always dark on white so phones read it in dark
 * mode too), with client-side PNG and SVG downloads.
 */
export function SendoQrCode({
  value,
  label,
  level = "auto",
  fileName = "whatsapp",
  hideDownloads = false,
  className,
  strings: overrides,
}: SendoQrCodeProps) {
  const strings = resolveWidgetsStrings(overrides);
  const { matrix, used } = useMemo(() => {
    const first = encodeQr(value, level === "auto" ? "H" : level);
    if (level !== "auto" || first === null || first.length <= QR_DENSE_MODULES) {
      return { matrix: first, used: level === "auto" ? "H" : level };
    }
    return { matrix: encodeQr(value, "Q"), used: "Q" as const };
  }, [value, level]);

  if (matrix === null) {
    return (
      <p role="alert" className={cn("text-sm text-destructive", className)}>
        {strings.qrTooLong}
      </p>
    );
  }

  const size = matrix.length + QR_QUIET_ZONE * 2;

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${String(size)} ${String(size)}`}
        shapeRendering="crispEdges"
        data-modules={matrix.length}
        data-level={used}
        className="aspect-square w-full max-w-60 rounded-lg ring-1 ring-border"
      >
        <rect width={size} height={size} fill="#ffffff" />
        <path d={qrPath(matrix)} fill="#000000" />
      </svg>
      {matrix.length > QR_DENSE_MODULES && (
        <p className="text-center text-xs text-muted-foreground">{strings.qrDense}</p>
      )}
      {!hideDownloads && (
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={pressClass}
            onClick={() => {
              void qrPngBlob(matrix).then((blob) => {
                saveBlob(blob, `${fileName}.png`);
              });
            }}
          >
            <Download aria-hidden />
            {strings.downloadPng}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={pressClass}
            onClick={() => {
              saveBlob(
                new Blob([qrSvgMarkup(matrix)], { type: "image/svg+xml" }),
                `${fileName}.svg`,
              );
            }}
          >
            <Download aria-hidden />
            {strings.downloadSvg}
          </Button>
        </div>
      )}
    </div>
  );
}
