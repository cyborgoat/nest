import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { ClaudeModelsEditor } from "./ClaudeModelsEditor";
import {
  isDuplicateRow,
  parseModelRows,
  serializeModelRows,
} from "./model-rows";

afterEach(cleanup);

function Harness({ initial }: { initial: string[] }) {
  const [rows, setRows] = useState(initial);
  return (
    <I18nProvider locale="en">
      <TooltipProvider>
        <ClaudeModelsEditor rows={rows} onChange={setRows} />
      </TooltipProvider>
    </I18nProvider>
  );
}

function renderEditor(initial: string[]) {
  render(<Harness initial={initial} />);
}

function inputs(): HTMLInputElement[] {
  return screen
    .getAllByRole("textbox")
    .filter((el): el is HTMLInputElement => el instanceof HTMLInputElement);
}

function rowValues(): string[] {
  return inputs().map((input) => input.value);
}

describe("parseModelRows / serializeModelRows", () => {
  it("round-trips a newline list", () => {
    const rows = parseModelRows("glm-5.3\nclaude-sonnet-4-5");
    expect(rows).toEqual(["glm-5.3", "claude-sonnet-4-5"]);
    expect(serializeModelRows(rows)).toBe("glm-5.3\nclaude-sonnet-4-5");
  });

  it("empty string becomes one empty row", () => {
    expect(parseModelRows("")).toEqual([""]);
  });

  it("serialize trims, drops empty rows, dedupes keeping first order", () => {
    expect(serializeModelRows(["  a ", "", "b", "a", "  ", "b "])).toBe(
      "a\nb",
    );
  });

  it("serialize of all-empty rows is empty string", () => {
    expect(serializeModelRows(["", ""])).toBe("");
  });
});

describe("isDuplicateRow", () => {
  it("flags trimmed duplicates only", () => {
    const rows = ["glm-5.3", " glm-5.3 ", "claude"];
    expect(isDuplicateRow(rows, 0)).toBe(true);
    expect(isDuplicateRow(rows, 1)).toBe(true);
    expect(isDuplicateRow(rows, 2)).toBe(false);
    expect(isDuplicateRow(["", ""], 0)).toBe(false);
  });
});

describe("ClaudeModelsEditor", () => {
  it("shows a single empty row for an empty list", () => {
    renderEditor([""]);
    expect(rowValues()).toEqual([""]);
  });

  it("shows the current default model as a read-only first row", () => {
    render(
      <I18nProvider locale="en">
        <TooltipProvider>
          <ClaudeModelsEditor
            rows={["glm-5.3", ""]}
            defaultModel="claude-sonnet-4-5"
            onChange={() => {}}
          />
        </TooltipProvider>
      </I18nProvider>,
    );
    expect(rowValues()).toEqual(["claude-sonnet-4-5", "glm-5.3", ""]);
    expect(inputs()[0]).toBeDisabled();
    const defaultAction = screen.getByRole("button", { name: "default" });
    expect(defaultAction).toBeDisabled();
    expect(
      screen.getAllByRole("button", { name: /remove model/i }),
    ).toHaveLength(2);
  });

  it("omits the default row when no model is connected", () => {
    renderEditor(["glm-5.3"]);
    expect(rowValues()).toEqual(["glm-5.3"]);
    expect(
      screen.queryByRole("button", { name: "default" }),
    ).not.toBeInTheDocument();
  });

  it("renders a per-row test button that fires onTestRow", () => {
    const onTestRow = vi.fn();
    render(
      <I18nProvider locale="en">
        <ClaudeModelsEditor
          rows={["glm-5.3", ""]}
          onTestRow={onTestRow}
          onChange={() => {}}
        />
      </I18nProvider>,
    );
    const testButtons = screen.getAllByRole("button", { name: "Test" });
    expect(testButtons).toHaveLength(2);
    expect(testButtons[0]).toBeEnabled();
    expect(testButtons[1]).toBeDisabled();
    fireEvent.click(testButtons[0]);
    expect(onTestRow).toHaveBeenCalledWith(0);
  });

  it("shows Save on unsaved rows and fires onSaveRow", () => {
    const onTestRow = vi.fn();
    const onSaveRow = vi.fn();
    render(
      <I18nProvider locale="en">
        <ClaudeModelsEditor
          rows={["glm-5.3", "kimi"]}
          savedModels={new Set(["glm-5.3"])}
          onTestRow={onTestRow}
          onSaveRow={onSaveRow}
          onChange={() => {}}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(onTestRow).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSaveRow).toHaveBeenCalledWith(1);
  });

  it("shows failure messages only via tooltip on the status icon", () => {
    render(
      <I18nProvider locale="en">
        <TooltipProvider>
          <ClaudeModelsEditor
            rows={["glm-5.3", "kimi"]}
            rowStatuses={{
              "glm-5.3": { ok: false, message: "API Error: 400" },
              kimi: { ok: true, message: "passed at t1" },
            }}
            onTestRow={() => {}}
            onChange={() => {}}
          />
        </TooltipProvider>
      </I18nProvider>,
    );
    expect(screen.queryByText("API Error: 400")).not.toBeInTheDocument();
    const failIcon = screen.getByLabelText("Model unavailable");
    expect(failIcon).toBeInTheDocument();
    const okIcon = screen.getByLabelText("Model available");
    expect(okIcon).toBeInTheDocument();
    expect(document.querySelector('[title="API Error: 400"]')).toBeNull();
  });

  it("typing in a row keeps focus and does not auto-append", () => {
    renderEditor(["glm-5.3", ""]);
    const last = inputs()[1];
    fireEvent.change(last, { target: { value: "claude-sonnet-4-5" } });
    expect(rowValues()).toEqual(["glm-5.3", "claude-sonnet-4-5"]);
    expect(document.activeElement).not.toBe(inputs()[1]);
    expect(inputs()[1].value).toBe("claude-sonnet-4-5");
  });

  it("Enter in the last non-empty row adds and focuses a new row", () => {
    renderEditor(["glm-5.3", "claude-sonnet-4-5"]);
    const last = inputs()[1];
    fireEvent.keyDown(last, { key: "Enter" });
    expect(rowValues()).toEqual(["glm-5.3", "claude-sonnet-4-5", ""]);
    expect(inputs()[2]).toHaveFocus();
  });

  it("Enter in an empty last row does not add another row", () => {
    renderEditor(["glm-5.3", ""]);
    fireEvent.keyDown(inputs()[1], { key: "Enter" });
    expect(rowValues()).toEqual(["glm-5.3", ""]);
  });

  it("removing the last non-empty row keeps one empty row", () => {
    renderEditor(["glm-5.3"]);
    fireEvent.click(
      screen.getAllByRole("button", { name: /remove model/i })[0],
    );
    expect(rowValues()).toEqual([""]);
  });

  it("removing a middle row keeps the others", () => {
    renderEditor(["a", "b", ""]);
    fireEvent.click(
      screen.getAllByRole("button", { name: /remove model/i })[1],
    );
    expect(rowValues()).toEqual(["a", ""]);
  });

  it("Add model appends an empty focused row", () => {
    renderEditor(["glm-5.3", ""]);
    fireEvent.click(screen.getByRole("button", { name: /add model/i }));
    expect(rowValues()).toEqual(["glm-5.3", "", ""]);
    expect(inputs()[2]).toHaveFocus();
  });

  it("shows a duplicate hint for repeated IDs", () => {
    renderEditor(["glm-5.3", "glm-5.3", ""]);
    expect(screen.getAllByText("Duplicate")).toHaveLength(2);
  });

  it("disables all inputs and buttons when disabled", () => {
    render(
      <I18nProvider locale="en">
        <ClaudeModelsEditor
          rows={["a", ""]}
          disabled
          onChange={() => {}}
        />
      </I18nProvider>,
    );
    for (const input of inputs()) {
      expect(input).toBeDisabled();
    }
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("edits propagate through the controlled harness", () => {
    renderEditor(["a", ""]);
    act(() => {
      fireEvent.change(inputs()[1], { target: { value: "b" } });
    });
    expect(rowValues()).toEqual(["a", "b"]);
  });
});
