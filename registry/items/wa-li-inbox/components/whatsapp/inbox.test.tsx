// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { makeActions, mockViewport } from "../../../../test/inbox-factories";
import { Inbox } from "./inbox";
import { defaultInboxStrings } from "./strings";

beforeEach(() => {
  mockViewport(true);
});

describe("<Inbox>", () => {
  it("renders overridden strings instead of the defaults", () => {
    render(
      <Inbox
        strings={{ filterHuman: "Personas", listEmpty: "Nada por aquí" }}
        currentUserId="user-1"
        tenantId="tenant-1"
        realtimeClient={null}
        actions={makeActions()}
        initialConversations={[]}
      />,
    );
    expect(screen.getByRole("tab", { name: "Personas" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: defaultInboxStrings.filterHuman })).toBeNull();
    expect(screen.getByText("Nada por aquí")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: defaultInboxStrings.filterAgent })).toBeInTheDocument();
  });
});
