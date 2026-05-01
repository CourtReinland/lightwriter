import { describe, expect, it, vi } from "vitest";
import { buildPdfHtml, exportPdf } from "../src/services/fountainExporter";

describe("PDF export", () => {
  it("builds print HTML with forced Fountain prefixes stripped", () => {
    const html = buildPdfHtml("<p>!!MS AIDEN COUGHS</p><p>@AIDEN</p>", "", "Test Script");

    expect(html).toContain("<title>Test Script</title>");
    expect(html).toContain(">MS AIDEN COUGHS</p>");
    expect(html).toContain(">AIDEN</p>");
    expect(html).not.toContain(">!!MS");
    expect(html).not.toContain(">@AIDEN");
  });

  it("prints through a hidden iframe instead of opening a popup window", () => {
    const print = vi.fn();
    const focus = vi.fn();
    const write = vi.fn();
    const close = vi.fn();
    const open = vi.fn();
    const remove = vi.fn();
    const addEventListener = vi.fn();
    const iframe = {
      style: {},
      title: "",
      remove,
      contentWindow: { print, focus, addEventListener },
      contentDocument: { open, write, close },
    };
    const appendChild = vi.fn((node) => node);
    const createElement = vi.fn(() => iframe);
    const windowOpen = vi.fn(() => {
      throw new Error("window.open should not be called");
    });
    const setTimeoutMock = vi.fn((handler: TimerHandler) => {
      if (typeof handler === "function") handler();
      return 0;
    });

    vi.stubGlobal("window", {
      open: windowOpen,
      setTimeout: setTimeoutMock,
      alert: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement,
      body: { appendChild },
    });

    try {
      exportPdf("<p>Action</p>", "", "Test Script");
    } finally {
      vi.unstubAllGlobals();
    }

    expect(windowOpen).not.toHaveBeenCalled();
    expect(createElement).toHaveBeenCalledWith("iframe");
    expect(appendChild).toHaveBeenCalledWith(iframe);
    expect(write).toHaveBeenCalledWith(expect.stringContaining("Test Script"));
    expect(focus).toHaveBeenCalled();
    expect(print).toHaveBeenCalled();
  });
});
