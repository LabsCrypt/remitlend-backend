import { jest } from "@jest/globals";

const mockLookup =
  jest.fn<(host: string, opts: unknown) => Promise<{ address: string }[]>>();

jest.unstable_mockModule("node:dns/promises", () => ({
  default: { lookup: mockLookup },
  lookup: mockLookup,
}));

const { assertCallbackUrlAllowed, isBlockedIp, SsrfValidationError } =
  await import("../ssrfGuard.js");

describe("ssrfGuard", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("isBlockedIp", () => {
    it.each([
      "127.0.0.1",
      "169.254.169.254",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "0.0.0.0",
      "100.64.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ])("blocks %s", (ip) => {
      expect(isBlockedIp(ip)).toBe(true);
    });

    it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:2800:220:1::"])(
      "allows public address %s",
      (ip) => {
        expect(isBlockedIp(ip)).toBe(false);
      },
    );
  });

  describe("assertCallbackUrlAllowed", () => {
    it("rejects non-http(s) schemes", async () => {
      await expect(
        assertCallbackUrlAllowed("ftp://example.com"),
      ).rejects.toBeInstanceOf(SsrfValidationError);
    });

    it("rejects an IP literal in a private range without DNS lookup", async () => {
      await expect(
        assertCallbackUrlAllowed("http://127.0.0.1/hook"),
      ).rejects.toBeInstanceOf(SsrfValidationError);
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it("rejects the cloud metadata IP literal", async () => {
      await expect(
        assertCallbackUrlAllowed("http://169.254.169.254/latest/meta-data"),
      ).rejects.toBeInstanceOf(SsrfValidationError);
    });

    it("rejects a host that resolves to a 10.x address", async () => {
      mockLookup.mockResolvedValueOnce([{ address: "10.0.0.5" }]);
      await expect(
        assertCallbackUrlAllowed("https://internal.example.com/hook"),
      ).rejects.toBeInstanceOf(SsrfValidationError);
    });

    it("allows a host that resolves to a public address", async () => {
      mockLookup.mockResolvedValueOnce([{ address: "93.184.216.34" }]);
      await expect(
        assertCallbackUrlAllowed("https://consumer.example.com/hook"),
      ).resolves.toBeUndefined();
    });

    it("rejects when any resolved address is private", async () => {
      mockLookup.mockResolvedValueOnce([
        { address: "93.184.216.34" },
        { address: "127.0.0.1" },
      ]);
      await expect(
        assertCallbackUrlAllowed("https://rebind.example.com/hook"),
      ).rejects.toBeInstanceOf(SsrfValidationError);
    });
  });
});
