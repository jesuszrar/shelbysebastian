import { describe, expect, it } from "vitest";

import { getProductImageGallery } from "./product-image-gallery";

const product = {
  image: "/parent-cover.jpg",
  images: ["/parent-cover.jpg", "/parent-gallery.jpg"],
  subproducts: [
    { id: "variant-a", image: "/variant-a-cover.jpg", images: ["/variant-a-cover.jpg", "/variant-a-gallery.jpg"] },
    { id: "variant-b", image: "/variant-b-cover.jpg", images: ["/variant-b-cover.jpg", "/variant-b-gallery.jpg"] },
    { id: "variant-empty", image: null, images: [] },
  ],
};

describe("getProductImageGallery", () => {
  it("returns only the selected variant gallery and keeps its order", () => {
    expect(getProductImageGallery(product, "variant-a")).toEqual([
      "/variant-a-cover.jpg",
      "/variant-a-gallery.jpg",
    ]);
  });

  it("switching variants replaces the prior gallery instead of mixing images", () => {
    const firstGallery = getProductImageGallery(product, "variant-a");
    const secondGallery = getProductImageGallery(product, "variant-b");

    expect(secondGallery).toEqual(["/variant-b-cover.jpg", "/variant-b-gallery.jpg"]);
    expect(secondGallery).not.toContain(firstGallery[1]);
  });

  it("restores the parent gallery and safely returns an empty gallery when there are no images", () => {
    expect(getProductImageGallery(product)).toEqual(["/parent-cover.jpg", "/parent-gallery.jpg"]);
    expect(getProductImageGallery(product, "variant-empty")).toEqual([]);
  });

  it("includes the primary image without disturbing the order of an existing gallery", () => {
    expect(getProductImageGallery({
      image: "/parent-primary.jpg",
      images: ["/parent-one.jpg", "/parent-two.jpg"],
    })).toEqual(["/parent-primary.jpg", "/parent-one.jpg", "/parent-two.jpg"]);
    expect(getProductImageGallery({
      image: "/images/primary.jpg",
      images: ["/images/./primary.jpg", "/images/other.jpg"],
    })).toEqual(["/images/./primary.jpg", "/images/other.jpg"]);
    expect(getProductImageGallery({
      image: "/variant-primary.jpg",
      subproducts: [{
        id: "variant-primary",
        image: "/variant-primary.jpg",
        images: ["/variant-one.jpg", "/variant-two.jpg"],
      }],
    }, "variant-primary")).toEqual([
      "/variant-primary.jpg",
      "/variant-one.jpg",
      "/variant-two.jpg",
    ]);
  });

  it("compares normalized URLs while preserving displayed URLs and deduplicating only per gallery", () => {
    const sharedUrl = "https://cdn.example.com/images/shared.jpg";
    const result = getProductImageGallery({
      image: sharedUrl,
      images: [sharedUrl, sharedUrl, " /images/./shared.jpg ", "/images/shared.jpg", "/images/other.jpg"],
      subproducts: [{
        id: "shared",
        image: sharedUrl,
        images: [sharedUrl, "https://cdn.example.com/images/shared.jpg"],
      }],
    });

    expect(result).toEqual([sharedUrl, " /images/./shared.jpg ", "/images/other.jpg"]);
    expect(getProductImageGallery({
      image: sharedUrl,
      images: [sharedUrl],
      subproducts: [{
        id: "shared",
        image: sharedUrl,
        images: [sharedUrl],
      }],
    }, "shared")).toEqual([sharedUrl]);
    expect(getProductImageGallery({
      image: sharedUrl,
      images: [sharedUrl],
      subproducts: [{
        id: "shared",
        image: sharedUrl,
        images: [sharedUrl],
      }],
    })).toEqual([sharedUrl]);
  });

  it("keeps relative URLs distinct when their resolution can differ", () => {
    expect(getProductImageGallery({
      image: "cover.jpg",
      images: ["./cover.jpg", "cover.jpg", "../cover.jpg"],
    })).toEqual(["./cover.jpg", "../cover.jpg"]);
  });

  it("ignores invalid image values without changing valid URL strings", () => {
    const invalidGallery = [null, 4, {}, "  ", "/valid.jpg"] as unknown as string[];
    expect(getProductImageGallery({
      image: null,
      images: invalidGallery,
    })).toEqual(["/valid.jpg"]);
  });
});
