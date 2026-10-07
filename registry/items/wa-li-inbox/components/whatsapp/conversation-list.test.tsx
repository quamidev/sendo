// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeConversation } from "../../../../test/inbox-factories";
import { ConversationList } from "./conversation-list";

function renderList(enteringIds?: ReadonlySet<string>) {
  return render(
    <ConversationList
      conversations={[
        makeConversation({
          id: "old",
          contact: { id: "c1", phone: "+50255550001", displayName: "Ana Pérez", appRef: null },
        }),
        makeConversation({
          id: "new",
          contact: { id: "c2", phone: "+50255550002", displayName: "Luis Gómez", appRef: null },
        }),
      ]}
      selectedId={null}
      onSelect={vi.fn()}
      enteringIds={enteringIds}
      filter="human"
      onFilterChange={vi.fn()}
      assignedToMe={false}
      onAssignedToMeChange={vi.fn()}
    />,
  );
}

describe("<ConversationList> motion", () => {
  it("renders the first page without any enter motion", () => {
    renderList();
    for (const name of [/Ana Pérez/, /Luis Gómez/]) {
      expect(screen.getByRole("button", { name }).closest("li")).not.toHaveAttribute("data-motion");
    }
  });

  it("plays the enter motion only on rows that arrived after mount", () => {
    renderList(new Set(["new"]));
    expect(screen.getByRole("button", { name: /Luis Gómez/ }).closest("li")).toHaveAttribute(
      "data-motion",
      "enter",
    );
    expect(screen.getByRole("button", { name: /Ana Pérez/ }).closest("li")).not.toHaveAttribute(
      "data-motion",
    );
  });
});
