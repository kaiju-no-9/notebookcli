import { describe, expect, it } from "bun:test";
import { AgentUI } from "./AgentUI.js";

describe("AgentUI", (): void => {
  it("renders response text through its output writer", (): void => {
    let output = "";
    const ui = new AgentUI((text: string): void => { output = text; });
    ui.render("A response");
    expect(output).toBe("A response");
  });
});
