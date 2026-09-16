# Walker Discovery Worker — Railway runtime image.
#
# W2 needs a real headless browser, which needs OS libraries Nixpacks cannot
# install cleanly (Playwright's dependency installer uses apt). A Debian-based
# Node 22 image plus `playwright install --with-deps chromium` is the reliable,
# minimal provisioning: it installs the browser build matching the pinned
# Playwright version AND the required system libs, so Playwright resolves the
# browser natively at runtime (no executablePath override needed on Railway).

FROM node:22-bookworm-slim

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Install ONLY chromium plus its OS dependencies (apt is available on bookworm).
# Matches the pinned playwright version, so runtime resolution needs no override.
RUN npx playwright install --with-deps chromium

# Build the TypeScript sources to dist/.
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Railway injects PORT; the health server defaults to 8080 if unset.
CMD ["node", "dist/main.js"]
