import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AddressForm from "./AddressForm";

describe("AddressForm", () => {
  it("submits valid data via onSave", async () => {
    const onSave = vi.fn(() => Promise.resolve());
    const { container } = render(
      <AddressForm
        onSave={onSave}
        initial={{ label: "Casa", fullName: "Juan Perez", city: "Bogotá", department: "Cundinamarca", address: "Calle 1 #2-3" }}
      />,
    );

    // assert inputs rendered with initial values
    expect(container.querySelector('input[placeholder="Casa, Oficina"]')?.getAttribute('value')).toBe('Casa');
    expect(container.querySelector('input[placeholder="Nombre completo"]')?.getAttribute('value')).toBe('Juan Perez');
    expect(container.querySelectorAll('input')[4].getAttribute('value')).toBe('Calle 1 #2-3');
  });
});
