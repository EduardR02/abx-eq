import { describe, expect, test } from "bun:test";
import path from "node:path";
import { safePublicPath } from "../server.ts";

describe("safePublicPath", () => {
  test("resolves in-public files", () => {
    const publicDir = path.join(process.cwd(), "public");

    expect(safePublicPath("/")).toBe(path.join(publicDir, "index.html"));
    expect(safePublicPath("/style.css")).toBe(path.join(publicDir, "style.css"));
  });

  test("blocks path traversal into sibling directories", () => {
    expect(safePublicPath("/../public-evil/index.html")).toBeNull();
  });

  test("blocks direct traversal outside public", () => {
    expect(safePublicPath("/../../server.ts")).toBeNull();
  });
});
