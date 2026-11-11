import { fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";

import ProductDetail from "./ProductDetail";
import { useProductsCatalog } from "@/context/ProductsContext";
import type { Product } from "@/data/products";

const { add } = vi.hoisted(() => ({
  add: vi.fn(),
}));

const product: Product = {
  id: "product-1",
  name: "Producto de prueba",
  category: "Adhesivas",
  image: "/parent-cover.jpg",
  images: ["/parent-cover.jpg", "/parent-gallery.jpg"],
  price: 100,
  stock: 5,
  description: "Producto para probar galerías",
  specs: [],
  subproducts: [
    {
      id: "variant-a",
      name: "Variante A",
      image: "/variant-a-cover.jpg",
      images: ["/variant-a-cover.jpg", "/variant-a-gallery.jpg"],
      price: 10,
      stock: 5,
      description: "Primera variante",
    },
    {
      id: "variant-b",
      name: "Variante B",
      image: "/variant-b-cover.jpg",
      images: ["/variant-b-cover.jpg", "/variant-b-gallery.jpg"],
      price: 20,
      stock: 5,
      description: "Segunda variante",
    },
    {
      id: "variant-empty",
      name: "Variante vacía",
      image: "",
      images: [],
      price: 30,
      stock: 5,
      description: "Variante sin imágenes",
    },
    {
      id: "variant-no-primary",
      name: "Variante sin imagen principal",
      image: "",
      images: ["/variant-only-gallery.jpg"],
      price: 40,
      stock: 5,
      description: "Variante con galería",
    },
  ],
};

vi.mock("@/context/ProductsContext", () => ({
  useProductsCatalog: vi.fn(),
}));
vi.mock("@/context/CartContext", () => ({
  useCart: () => ({ add, hydrated: true }),
}));
vi.mock("@/components/shelby/Navbar", () => ({ Navbar: () => null }));
vi.mock("@/components/shelby/Footer", () => ({ Footer: () => null }));
vi.mock("@/lib/metaPixel", () => ({
  trackAddToCart: vi.fn(),
  trackViewContent: vi.fn(),
}));

const NavigateToSecondProduct = () => {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate("/products/product-2")}>Cambiar producto</button>;
};

describe("ProductDetail image galleries", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.mocked(useProductsCatalog).mockReturnValue({
      products: [product],
      rows: [],
      loading: false,
      error: null,
      refreshProducts: vi.fn(),
    });
  });

  it("shows only the active gallery, allows browsing it, and resets on selection changes", () => {
    render(
      <MemoryRouter initialEntries={["/products/product-1"]}>
        <Routes>
          <Route path="/products/:productId" element={<ProductDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    const mainImage = screen.getByRole("img", { name: "Producto de prueba" });
    expect(mainImage).toHaveAttribute("src", "/parent-cover.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Ver imagen 2 de Producto de prueba" }));
    expect(mainImage).toHaveAttribute("src", "/parent-gallery.jpg");

    fireEvent.click(screen.getByRole("button", { name: /Variante A/ }));
    expect(mainImage).toHaveAttribute("src", "/parent-gallery.jpg");
    expect(screen.getByRole("dialog", { name: "Variante A" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Variante A" }).querySelector("img")).toHaveAttribute("src", "/variant-a-cover.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar imagen" }));

    fireEvent.click(screen.getByRole("button", { name: /Variante B/ }));
    expect(mainImage).toHaveAttribute("src", "/parent-gallery.jpg");
    expect(screen.getByRole("dialog", { name: "Variante B" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Variante B" }).querySelector("img")).toHaveAttribute("src", "/variant-b-cover.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar imagen" }));

    fireEvent.click(screen.getByRole("button", { name: /Variante vac/ }));
    expect(mainImage).toHaveAttribute("src", "/parent-gallery.jpg");
    expect(screen.getByRole("dialog", { name: /Variante vac/ }).querySelector("img")).toHaveAttribute("src", "/placeholder.svg");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar imagen" }));

    fireEvent.click(screen.getByRole("button", { name: /Variante sin imagen principal/ }));
    expect(mainImage).toHaveAttribute("src", "/parent-gallery.jpg");
    expect(screen.getByRole("dialog", { name: "Variante sin imagen principal" }).querySelector("img")).toHaveAttribute("src", "/variant-only-gallery.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar imagen" }));

    fireEvent.click(screen.getByRole("button", { name: /Producto principal/ }));
    expect(mainImage).toHaveAttribute("src", "/parent-cover.jpg");
    expect(screen.getByRole("button", { name: "Ver imagen 2 de Producto de prueba" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver imagen 2 de Variante B" })).not.toBeInTheDocument();
  });

  it("navigates circularly, synchronizes active thumbnails, and disables navigation for one image", () => {
    render(
      <MemoryRouter initialEntries={["/products/product-1"]}>
        <Routes>
          <Route path="/products/:productId" element={<ProductDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    const mainImage = screen.getByRole("img", { name: "Producto de prueba" });
    const previous = screen.getByRole("button", { name: "Imagen anterior de Producto de prueba" });
    const next = screen.getByRole("button", { name: "Imagen siguiente de Producto de prueba" });
    expect(previous).toBeEnabled();
    expect(next).toBeEnabled();

    fireEvent.click(previous);
    expect(mainImage).toHaveAttribute("src", "/parent-gallery.jpg");
    expect(screen.getByRole("button", { name: "Ver imagen 2 de Producto de prueba" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(next);
    expect(mainImage).toHaveAttribute("src", "/parent-cover.jpg");
    expect(screen.getByRole("button", { name: "Ver imagen 1 de Producto de prueba" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: /Variante A/ }));
    expect(mainImage).toHaveAttribute("src", "/parent-cover.jpg");
    expect(screen.getByRole("dialog", { name: "Variante A" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar imagen" }));

    fireEvent.click(screen.getByRole("button", { name: /Variante B/ }));
    expect(mainImage).toHaveAttribute("src", "/parent-cover.jpg");
    expect(screen.getByRole("dialog", { name: "Variante B" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar imagen" }));

    fireEvent.click(screen.getByRole("button", { name: /Variante sin imagen principal/ }));
    expect(mainImage).toHaveAttribute("src", "/parent-cover.jpg");
    expect(screen.getByRole("dialog", { name: "Variante sin imagen principal" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar imagen" }));
  });

  it("preserves the selected variant and image on catalog refresh, then resets if the variant disappears", () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={["/products/product-1"]}>
        <Routes>
          <Route path="/products/:productId" element={<ProductDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    const mainImage = screen.getByRole("img", { name: "Producto de prueba" });
    fireEvent.click(screen.getByRole("button", { name: /Variante A/ }));
    expect(mainImage).toHaveAttribute("src", "/parent-cover.jpg");
    expect(screen.getByRole("dialog", { name: "Variante A" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar imagen" }));

    vi.mocked(useProductsCatalog).mockReturnValue({
      products: [{ ...product, subproducts: product.subproducts?.map((variant) => ({ ...variant })) }],
      rows: [],
      loading: false,
      error: null,
      refreshProducts: vi.fn(),
    });
    rerender(
      <MemoryRouter initialEntries={["/products/product-1"]}>
        <Routes>
          <Route path="/products/:productId" element={<ProductDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(mainImage).toHaveAttribute("src", "/parent-cover.jpg");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem("shelby:product-gallery:product-1")).toContain("variant-a");

    vi.mocked(useProductsCatalog).mockReturnValue({
      products: [{
        ...product,
        subproducts: product.subproducts?.filter((variant) => variant.id !== "variant-a"),
      }],
      rows: [],
      loading: false,
      error: null,
      refreshProducts: vi.fn(),
    });
    rerender(
      <MemoryRouter initialEntries={["/products/product-1"]}>
        <Routes>
          <Route path="/products/:productId" element={<ProductDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(mainImage).toHaveAttribute("src", "/parent-cover.jpg");
    expect(screen.queryByRole("button", { name: /Ver imagen .*Variante A/ })).not.toBeInTheDocument();
  });

  it("resets the selected variant when navigating to a different product", () => {
    const secondProduct: Product = {
      ...product,
      id: "product-2",
      name: "Otro producto",
      image: "/second-product.jpg",
      images: ["/second-product.jpg"],
      subproducts: [],
    };
    vi.mocked(useProductsCatalog).mockReturnValue({
      products: [product, secondProduct],
      rows: [],
      loading: false,
      error: null,
      refreshProducts: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/products/product-1"]}>
        <NavigateToSecondProduct />
        <Routes>
          <Route path="/products/:productId" element={<ProductDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Variante A/ }));
    expect(screen.getByRole("dialog", { name: "Variante A" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cambiar producto" }));

    expect(screen.getByRole("img", { name: "Otro producto" })).toHaveAttribute("src", "/second-product.jpg");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Variante A/ })).not.toBeInTheDocument();
  });

  it("restores the selected variant and image after a full component reload", () => {
    const firstRender = render(
      <StrictMode>
        <MemoryRouter initialEntries={["/products/product-1"]}>
          <Routes>
            <Route path="/products/:productId" element={<ProductDetail />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Variante A/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar imagen" }));
    firstRender.unmount();

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/products/product-1"]}>
          <Routes>
            <Route path="/products/:productId" element={<ProductDetail />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    expect(screen.getByRole("img", { name: "Producto de prueba" })).toHaveAttribute("src", "/parent-cover.jpg");
    expect(window.sessionStorage.getItem("shelby:product-gallery:product-1")).toContain("variant-a");
  });

  it("uses separate session selections for different products", () => {
    const secondProduct: Product = {
      ...product,
      id: "product-2",
      name: "Otro producto",
      image: "/second-product.jpg",
      images: ["/second-product.jpg"],
      subproducts: [],
    };
    vi.mocked(useProductsCatalog).mockReturnValue({
      products: [product, secondProduct],
      rows: [],
      loading: false,
      error: null,
      refreshProducts: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={["/products/product-1"]}>
        <NavigateToSecondProduct />
        <Routes>
          <Route path="/products/:productId" element={<ProductDetail />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Variante A/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar imagen" }));
    fireEvent.click(screen.getByRole("button", { name: "Cambiar producto" }));

    expect(screen.getByRole("img", { name: "Otro producto" })).toHaveAttribute("src", "/second-product.jpg");
    expect(window.sessionStorage.getItem("shelby:product-gallery:product-1")).toContain("variant-a");
    expect(window.sessionStorage.getItem("shelby:product-gallery:product-2")).toContain("second-product.jpg");
  });

  it("discards a saved variant that no longer belongs to the product", () => {
    window.sessionStorage.setItem("shelby:product-gallery:product-1", JSON.stringify({
      variantId: "deleted-variant",
      image: "/deleted.jpg",
    }));

    render(
      <MemoryRouter initialEntries={["/products/product-1"]}>
        <Routes>
          <Route path="/products/:productId" element={<ProductDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("img", { name: "Producto de prueba" })).toHaveAttribute("src", "/parent-cover.jpg");
    expect(window.sessionStorage.getItem("shelby:product-gallery:product-1")).toBe(
      JSON.stringify({ variantId: null, image: "/parent-cover.jpg" }),
    );
  });

  it("replaces a saved image that is no longer in the selected variant gallery", () => {
    window.sessionStorage.setItem("shelby:product-gallery:product-1", JSON.stringify({
      variantId: "variant-a",
      image: "/removed.jpg",
    }));

    render(
      <MemoryRouter initialEntries={["/products/product-1"]}>
        <Routes>
          <Route path="/products/:productId" element={<ProductDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("img", { name: "Producto de prueba" })).toHaveAttribute("src", "/parent-cover.jpg");
    expect(window.sessionStorage.getItem("shelby:product-gallery:product-1")).toBe(
      JSON.stringify({ variantId: "variant-a", image: "/parent-cover.jpg" }),
    );
  });

  it("restores an image-less variant while keeping the parent gallery", () => {
    window.sessionStorage.setItem("shelby:product-gallery:product-1", JSON.stringify({
      variantId: "variant-empty",
      image: "/stale.jpg",
    }));

    render(
      <MemoryRouter initialEntries={["/products/product-1"]}>
        <Routes>
          <Route path="/products/:productId" element={<ProductDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("img", { name: "Producto de prueba" })).toHaveAttribute("src", "/parent-cover.jpg");
    expect(window.sessionStorage.getItem("shelby:product-gallery:product-1")).toBe(
      JSON.stringify({ variantId: "variant-empty", image: "/parent-cover.jpg" }),
    );
  });
});
