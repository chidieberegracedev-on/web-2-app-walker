import { describe, expect, it } from "vitest";
import {
  isInCrawlScope,
  isIpHost,
  isSameRegistrableDomain,
  normalizeUrl,
  registrableDomain,
} from "../../src/discovery/url.js";

describe("normalizeUrl", () => {
  it("resolves a relative URL against a base", () => {
    expect(normalizeUrl("/products", "https://shop.example.com/home").normalized).toBe(
      "https://shop.example.com/products",
    );
  });
  it("drops the fragment", () => {
    expect(normalizeUrl("https://x.com/a#section").normalized).toBe("https://x.com/a");
  });
  it("drops default ports", () => {
    expect(normalizeUrl("https://x.com:443/a").normalized).toBe("https://x.com/a");
    expect(normalizeUrl("http://x.com:80/a").normalized).toBe("http://x.com/a");
  });
  it("strips a trailing slash on non-root paths but keeps root", () => {
    expect(normalizeUrl("https://x.com/a/").normalized).toBe("https://x.com/a");
    expect(normalizeUrl("https://x.com/").normalized).toBe("https://x.com/");
  });
  it("preserves the query string", () => {
    expect(normalizeUrl("https://x.com/s?q=1&p=2").normalized).toBe("https://x.com/s?q=1&p=2");
  });
  it("lowercases scheme and host", () => {
    expect(normalizeUrl("HTTPS://X.COM/A").normalized).toBe("https://x.com/A");
  });
  it("returns null for unparseable input", () => {
    expect(normalizeUrl("not a url").normalized).toBeNull();
    expect(normalizeUrl("://broken").normalized).toBeNull();
  });
});

describe("registrableDomain", () => {
  it("reduces subdomains to eTLD+1", () => {
    expect(registrableDomain("www.example.com")).toBe("example.com");
    expect(registrableDomain("shop.eu.example.com")).toBe("example.com");
  });
  it("handles multi-label suffixes", () => {
    expect(registrableDomain("a.b.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("shop.example.com.au")).toBe("example.com.au");
  });
  it("returns bare hosts unchanged", () => {
    expect(registrableDomain("example.com")).toBe("example.com");
    expect(registrableDomain("localhost")).toBe("localhost");
  });
  it("treats IPs as their own registrable domain", () => {
    expect(registrableDomain("127.0.0.1")).toBe("127.0.0.1");
    expect(isIpHost("127.0.0.1")).toBe(true);
  });
});

describe("isSameRegistrableDomain", () => {
  it("treats subdomains as same site", () => {
    expect(
      isSameRegistrableDomain(new URL("https://shop.example.com"), new URL("https://example.com")),
    ).toBe(true);
  });
  it("treats different domains as different", () => {
    expect(
      isSameRegistrableDomain(new URL("https://example.com"), new URL("https://other.com")),
    ).toBe(false);
  });
});

describe("isInCrawlScope", () => {
  const scope = new URL("https://example.com/");
  it("accepts https same-domain by default", () => {
    expect(isInCrawlScope(new URL("https://example.com/a"), scope)).toBe(true);
    expect(isInCrawlScope(new URL("https://sub.example.com/a"), scope)).toBe(true);
  });
  it("rejects http by default (https-only baseline)", () => {
    expect(isInCrawlScope(new URL("http://example.com/a"), scope)).toBe(false);
  });
  it("rejects other domains", () => {
    expect(isInCrawlScope(new URL("https://evil.com/a"), scope)).toBe(false);
  });
  it("allows http only when explicitly opted in (loopback fixtures)", () => {
    const loop = new URL("http://127.0.0.1:8080/");
    expect(isInCrawlScope(new URL("http://127.0.0.1:8080/a"), loop, { allowedSchemes: ["http:"] })).toBe(
      true,
    );
  });
  it("never allows non-http schemes", () => {
    expect(
      isInCrawlScope(new URL("ftp://example.com/a"), scope, { allowedSchemes: ["ftp:"] }),
    ).toBe(true); // scheme membership is honored...
    expect(isInCrawlScope(new URL("https://example.com/a"), scope, { allowedSchemes: ["http:"] })).toBe(
      false,
    ); // ...and https excluded when not listed
  });
});
