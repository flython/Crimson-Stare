import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "../src/index.js";

describe("engine 包自检", () => {
  it("导出版本号", () => {
    expect(ENGINE_VERSION).toBe("0.1.0");
  });
});
