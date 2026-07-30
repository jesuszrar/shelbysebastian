import { describe, expect, it } from "vitest";
import { wrap } from "../../backend/src/lib/serialize";

describe("backend serialization", () => {
  it("converts Date values to ISO strings", () => {
    const payload = {
      expiresAt: new Date("2024-01-02T03:04:05.000Z"),
      createdAt: new Date("2024-02-03T04:05:06.000Z"),
      nested: {
        updatedAt: new Date("2024-03-04T05:06:07.000Z"),
      },
    };

    expect(wrap(payload)).toEqual({
      expiresAt: "2024-01-02T03:04:05.000Z",
      createdAt: "2024-02-03T04:05:06.000Z",
      nested: {
        updatedAt: "2024-03-04T05:06:07.000Z",
      },
    });
  });
});
