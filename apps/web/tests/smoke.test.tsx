import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { cn } from "@/lib/utils";

describe("test harness", () => {
  it("renders React 19 components in jsdom", () => {
    render(<p className={cn("a", false && "b")}>ok</p>);
    expect(screen.getByText("ok")).toHaveClass("a");
  });
});
