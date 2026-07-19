import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function cacheVersion(paths) {
  let hash = 5381;
  for (const character of paths.join("|")) hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
  return (hash >>> 0).toString(36);
}

function outflowServiceWorker() {
  return {
    name: "outflow-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const publicAssets = [
        "/",
        "/index.html",
        "/manifest.webmanifest",
        "/outflow-icon.svg",
        "/outflow-icon-192.png",
        "/outflow-icon-512.png",
        "/apple-touch-icon.png",
        "/og.png",
      ];
      const generatedAssets = Object.values(bundle).map((entry) => `/${entry.fileName}`);
      const precache = [...new Set([...publicAssets, ...generatedAssets])].sort();
      const cacheName = `outflow-${cacheVersion(precache)}`;
      const source = `const CACHE_NAME = ${JSON.stringify(cacheName)};
const PRECACHE = ${JSON.stringify(precache)};

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
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", response.clone()));
          return response;
        })
        .catch(() => caches.match("/index.html")),
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

export default defineConfig({
  plugins: [react(), outflowServiceWorker()],
});
