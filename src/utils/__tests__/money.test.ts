import { fromCents, toCents } from "../money"

describe("money", () => {
  it("converts major units to cents without float drift", () => {
    expect(toCents(270.85)).toBe(27085)
    expect(toCents("2")).toBe(200)
    expect(toCents(0.29)).toBe(29)
  })

  it("converts cents back to major units", () => {
    expect(fromCents(27085)).toBe(270.85)
    expect(fromCents("200")).toBe(2)
  })
})
