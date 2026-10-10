import { describe, expect, it } from "bun:test";
import { TerminalState } from "./TerminalState.js";

describe("TerminalState", (): void => {
  it("tracks a single spinner lifecycle", (): void => {
    const state = new TerminalState();
    state.updateSpinner("ignored before start");
    expect(state.currentSpinnerMessage).toBeUndefined();
    state.startSpinner("working");
    state.updateSpinner("researching");
    expect(state.currentSpinnerMessage).toBe("researching");
    state.stopSpinner();
    expect(state.currentSpinnerMessage).toBeUndefined();
  });
});
