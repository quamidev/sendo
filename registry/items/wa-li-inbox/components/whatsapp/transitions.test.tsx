// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CrossFade } from "./transitions";

const label = (value: string) => <span>{value}</span>;

describe("<CrossFade>", () => {
  it("renders the first state without any motion", () => {
    render(<CrossFade value="sent" render={label} />);
    expect(screen.getByText("sent").closest("[data-motion]")).toBeNull();
    expect(screen.queryByText("pending")).toBeNull();
  });

  it("fades the previous state out (hidden from assistive tech) and the new one in", () => {
    const { rerender } = render(<CrossFade value="pending" render={label} />);
    rerender(<CrossFade value="sent" render={label} />);

    expect(screen.getByText("sent").closest("[data-motion='enter']")).not.toBeNull();
    const leaving = screen.getByText("pending").parentElement;
    expect(leaving).toHaveAttribute("aria-hidden", "true");
    expect(leaving).toHaveClass("opacity-0");
  });
});
