import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export function cacheVersion(entries) {
  const hash = createHash("sha256");
  [...entries]
    .sort((a, b) => a.path.localeCompare(b.path))
    .forEach((entry) => {
      hash.update(entry.path);
      hash.update("\0");
      hash.update(entry.content);
      hash.update("\0");
    });
  return hash.digest("hex").slice(0, 12);
}

export function normalizePublicBase(value = "/") {
  const candidate = String(value || "/").trim();
  if (!candidate.startsWith("/") || candidate.includes("?") || candidate.includes("#")) {
    throw new Error("OUTFLOW_PUBLIC_BASE must be an absolute path without a query or fragment.");
  }
  return `${candidate.replace(/\/{2,}/g, "/").replace(/\/$/, "")}/`;
}

function outflowServiceWorker() {
  let projectRoot = "";
  let publicDir = "";
  let publicBase = "/";

  return {
    name: "outflow-service-worker",
    apply: "build",
    configResolved(config) {
      projectRoot = config.root;
      publicDir = config.publicDir;
      publicBase = normalizePublicBase(config.base);
    },
    generateBundle(_options, bundle) {
      const publicAssetNames = [
        "manifest.webmanifest",
        "outflow-icon.svg",
        "outflow-icon-192.png",
        "outflow-icon-512.png",
        "apple-touch-icon.png",
        "og.png",
      ];
      const indexPath = `${publicBase}index.html`;
      const publicAssets = [
        publicBase,
        indexPath,
        ...publicAssetNames.map((name) => `${publicBase}${name}`),
      ];
      const generatedEntries = Object.values(bundle)
        .map((entry) => ({
          path: `${publicBase}${entry.fileName}`,
          content: entry.type === "asset" ? entry.source : entry.code,
        }));
      const contentByPath = new Map(generatedEntries.map((entry) => [entry.path, entry.content]));
      const indexContent = readFileSync(resolve(projectRoot, "index.html"));
      contentByPath.set(indexPath, indexContent);
      contentByPath.set(publicBase, indexContent);

      publicAssetNames.forEach((name) => {
        const path = `${publicBase}${name}`;
        if (!contentByPath.has(path)) contentByPath.set(path, readFileSync(resolve(publicDir, name)));
      });

      const generatedAssets = generatedEntries.map((entry) => entry.path);
      const precache = [...new Set([...publicAssets, ...generatedAssets])].sort();
      const cacheName = `outflow-${cacheVersion([...contentByPath].map(([path, content]) => ({ path, content })))}`;
      const source = `const CACHE_NAME = ${JSON.stringify(cacheName)};
const PRECACHE = ${JSON.stringify(precache)};
const INDEX_URL = ${JSON.stringify(indexPath)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("outflow-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(INDEX_URL, response.clone()));
          return response;
        })
        .catch(() => caches.match(INDEX_URL)),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && response.type === "basic") {
        caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      }
      return response;
    })),
  );
});
`;

      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

const publicBase = normalizePublicBase(process.env.OUTFLOW_PUBLIC_BASE);
const tauriDevHost = process.env.TAURI_DEV_HOST;

export default defineConfig({
  base: publicBase,
  plugins: [react(), outflowServiceWorker()],
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  server: {
    port: 5173,
    strictPort: true,
    host: tauriDevHost || false,
    hmr: tauriDevHost
      ? {
          protocol: "ws",
          host: tauriDevHost,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
