import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import AddressList from "./AddressList";

vi.mock("@/integrations/api/client", () => ({
  getUserAddresses: vi.fn(async () => ({ data: [
    { id: "a1", label: "Casa", fullName: "Juan", department: "D", city: "C", address: "Addr", isDefault: true }
  ] })),
  createUserAddress: vi.fn(async () => ({})),
  patchUserAddress: vi.fn(async () => ({})),
  deleteUserAddress: vi.fn(async () => ({ ok: true })),
  setDefaultUserAddress: vi.fn(async () => ({})),
}));

describe("AddressList", () => {
  it("renders addresses and toggles form", async () => {
    render(<AddressList onSelect={vi.fn()} />);
    expect(screen.getByText(/Mis direcciones/i)).toBeInTheDocument();
    await waitFor(() => screen.getByText("Juan"));
    expect(screen.getByText("Juan")).toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /Agregar nueva dirección/i });
    fireEvent.click(toggle);
    await waitFor(() => screen.getByRole("button", { name: /Guardar dirección/i }));
    expect(screen.getByRole("button", { name: /Guardar dirección/i })).toBeInTheDocument();
  });
});
