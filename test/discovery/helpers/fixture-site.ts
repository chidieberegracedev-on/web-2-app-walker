import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A small multi-page loopback site for exercising the real DiscoveryEngine
 * without external egress. Covers: consistent nav (repeated-navigation), an
 * ecommerce section, a login page with an OAuth link, a redirect, a JS-rendered
 * (SPA-ish) page, a depth chain, and a minimal page with no icons/viewport.
 */

const NAV = `<nav>
  <a href="/">Home</a>
  <a href="/products">Products</a>
  <a href="/account">Account</a>
  <a href="/about">About</a>
</nav>`;

const HEAD_RICH = `
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="A test fixture site">
  <link rel="canonical" href="/">
  <link rel="icon" href="/favicon.ico">
  <link rel="apple-touch-icon" href="/touch.png">
  <meta property="og:image" content="/og.png">
  <link rel="manifest" href="/manifest.json">`;

const PAGES: Record<string, string> = {
  "/": `<!doctype html><html><head><title>Home</title>${HEAD_RICH}</head><body>${NAV}
    <h1>Welcome</h1><h2>Featured</h2>
    <a href="/deep/1">Deep 1</a>
    <a href="/search">Search</a>
    <a href="https://external.example.com/page">External</a>
    <a href="mailto:hello@example.com">Email us</a>
    <div class="card" style="border-radius:12px;padding:16px;box-shadow:0 1px 2px #0001;background:#fff">c</div>
    </body></html>`,

  "/products": `<!doctype html><html><head><title>Products</title>${HEAD_RICH}</head><body>${NAV}
    <h1>Products</h1>
    <a href="/products/1">Product One</a>
    <a href="/products/2">Product Two</a>
    <span>$19.99</span><span>$29.99</span><span>$39.99</span>
    <button>Add to cart</button>
    <script type="application/ld+json">{"@type":"Product","name":"Product One"}</script>
    </body></html>`,

  "/products/1": `<!doctype html><html><head><title>Product One</title>${HEAD_RICH}</head><body>${NAV}
    <h1>Product One</h1><span>$19.99</span>
    <form action="/cart" method="post"><input name="quantity" type="number" value="1"><button>Add to cart</button></form>
    </body></html>`,

  "/products/2": `<!doctype html><html><head><title>Product Two</title>${HEAD_RICH}</head><body>${NAV}
    <h1>Product Two</h1><span>$29.99</span>
    <form action="/cart" method="post"><input name="qty" type="number" value="1"><button>Add to cart</button></form>
    </body></html>`,

  "/account": `<!doctype html><html><head><title>Account</title>${HEAD_RICH}</head><body>${NAV}
    <h1>Sign in</h1>
    <form action="/login" method="post">
      <input name="email" type="email" placeholder="Email">
      <input name="password" type="password" placeholder="Password">
      <button>Log in</button>
    </form>
    <a href="https://accounts.google.com/o/oauth2/auth?client_id=x">Sign in with Google</a>
    </body></html>`,

  "/about": `<!doctype html><html><head><title>About</title></head><body>${NAV}
    <h1>About</h1><p>No icons and no viewport meta here on purpose.</p>
    </body></html>`,

  "/search": `<!doctype html><html><head><title>Search</title>${HEAD_RICH}</head><body>${NAV}
    <h1>Search</h1>
    <form role="search"><input type="search" name="q" placeholder="Search"></form>
    </body></html>`,

  "/spa": `<!doctype html><html><head><title>SPA</title>${HEAD_RICH}</head><body>${NAV}
    <div id="app"></div>
    <script>
      var el = document.createElement('div');
      el.innerHTML = '<h1>SPA Rendered</h1><a href="/spa-child">SPA Child</a>';
      document.getElementById('app').appendChild(el);
    </script>
    </body></html>`,

  "/spa-child": `<!doctype html><html><head><title>SPA Child</title>${HEAD_RICH}</head><body>${NAV}
    <h1>SPA Child</h1></body></html>`,

  "/deep/1": `<!doctype html><html><head><title>Deep 1</title>${HEAD_RICH}</head><body>${NAV}<h1>Deep 1</h1><a href="/deep/2">next</a></body></html>`,
  "/deep/2": `<!doctype html><html><head><title>Deep 2</title>${HEAD_RICH}</head><body>${NAV}<h1>Deep 2</h1><a href="/deep/3">next</a></body></html>`,
  "/deep/3": `<!doctype html><html><head><title>Deep 3</title>${HEAD_RICH}</head><body>${NAV}<h1>Deep 3</h1><a href="/deep/4">next</a></body></html>`,
  "/deep/4": `<!doctype html><html><head><title>Deep 4</title>${HEAD_RICH}</head><body>${NAV}<h1>Deep 4</h1></body></html>`,
};

const MANIFEST = JSON.stringify({
  name: "Fixture",
  icons: [
    { src: "/icon-192.png", sizes: "192x192" },
    { src: "/icon-512.png", sizes: "512x512" },
  ],
});

export interface RunningFixtureSite {
  readonly baseUrl: string;
  close: () => Promise<void>;
}

export async function startFixtureSite(): Promise<RunningFixtureSite> {
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;

    if (path === "/old") {
      res.writeHead(302, { Location: "/about" });
      res.end();
      return;
    }
    if (path === "/manifest.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(MANIFEST);
      return;
    }
    const body = PAGES[path];
    if (body === undefined) {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<h1>Not found</h1>");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
