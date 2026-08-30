import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AllocationLoadoutBar from "./AllocationLoadoutBar";

function renderBar({
  slots = [{}, {}, null, null, null, null, null, null],
  activeIndex = 0,
}: {
  slots?: readonly (object | null)[];
  activeIndex?: number;
} = {}) {
  const onCreate = vi.fn();
  const onSelect = vi.fn();
  const view = render(
    <AllocationLoadoutBar
      label="Spec"
      slots={slots}
      activeIndex={activeIndex}
      onCreate={onCreate}
      onSelect={onSelect}
    />,
  );
  return { ...view, onCreate, onSelect };
}

describe("AllocationLoadoutBar", () => {
  it("renders eight fixed positions with occupied numbers and empty plus controls", () => {
    renderBar();

    expect(screen.getByRole("group", { name: "Spec loadouts" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Select Spec loadout 1" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Select Spec loadout 2" }),
    ).toHaveAttribute("aria-pressed", "false");
    for (let number = 3; number <= 8; number += 1) {
      expect(
        screen.getByRole("button", {
          name: `Create Spec loadout ${number}`,
        }),
      ).toBeVisible();
    }
    expect(screen.getAllByRole("button")).toHaveLength(8);
  });

  it("selects occupied slots and creates the exact empty position clicked", async () => {
    const user = userEvent.setup();
    const { onCreate, onSelect } = renderBar();

    await user.click(
      screen.getByRole("button", { name: "Select Spec loadout 2" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Create Spec loadout 6" }),
    );

    expect(onSelect).toHaveBeenCalledWith(1);
    expect(onCreate).toHaveBeenCalledWith(5);
  });

  it("keeps focus when an empty position turns into its numbered loadout", () => {
    const { rerender } = renderBar();
    const empty = screen.getByRole("button", {
      name: "Create Spec loadout 3",
    });
    empty.focus();

    rerender(
      <AllocationLoadoutBar
        label="Spec"
        slots={[{}, {}, {}, null, null, null, null, null]}
        activeIndex={2}
        onCreate={() => {}}
        onSelect={() => {}}
      />,
    );

    const created = screen.getByRole("button", {
      name: "Select Spec loadout 3",
    });
    expect(created).toBe(empty);
    expect(created).toHaveFocus();
    expect(created).toHaveAttribute("aria-pressed", "true");
  });

  it("always exposes eight positions even while the store is being normalized", () => {
    renderBar({ slots: [{}] });

    expect(screen.getAllByRole("button")).toHaveLength(8);
    expect(
      screen.getByRole("button", { name: "Create Spec loadout 8" }),
    ).toBeVisible();
  });
});
