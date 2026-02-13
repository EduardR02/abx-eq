import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appSource = readFileSync(join(import.meta.dir, "..", "public", "app.js"), "utf8");
const htmlSource = readFileSync(join(import.meta.dir, "..", "public", "index.html"), "utf8");

describe("blind UI regression checks", () => {
  test("preference screen keeps matchup labels blinded", () => {
    expect(appSource).toContain('dom.matchupText.textContent = "A vs B";');
    expect(appSource).not.toContain("dom.matchupMeta.textContent = `A:");
  });

  test("ABX run screen keeps pair labels blinded", () => {
    expect(appSource).toContain('dom.abxNowText.textContent = "Testing pair: A vs B";');
  });

  test("tie terminology is consistent in controls and hints", () => {
    expect(appSource).toContain("tie: document.getElementById(\"prefer-draw\")");
    expect(appSource).not.toContain("No preference");
    expect(htmlSource).toContain("It's a tie");
    // Updated for new shortcut legend design
    expect(htmlSource).toContain("<kbd>X</kbd> Tie");
  });

  test("new preference matchup starts with A visually active", () => {
    expect(appSource).toContain("audio.setActiveVariant(pair.presetA);");
    expect(appSource).toContain("setActiveButton(dom.buttonA, true);");
    expect(appSource).toContain("setActiveButton(dom.buttonB, false);");
  });
});
