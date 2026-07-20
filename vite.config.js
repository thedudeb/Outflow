import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
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

function configuredSupabaseSources(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return [];
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
      || !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname)
    ) throw new Error("invalid");
    return [url.origin, `wss://${url.host}`];
  } catch {
    throw new Error("VITE_SUPABASE_URL must be an exact hosted Supabase HTTPS origin before building web security policy.");
  }
}

export function webContentSecurityPolicy(environment = {}) {
  const nativeBuild = Boolean(environment.TAURI_ENV_PLATFORM);
  const connectSources = ["'self'", ...configuredSupabaseSources(environment.VITE_SUPABASE_URL)];
  const imageSources = ["'self'", "blob:", "data:"];
  if (nativeBuild) {
    connectSources.push("ipc:", "http://ipc.localhost");
    imageSources.push("asset:", "http://asset.localhost");
  }
  return [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "font-src 'self'",
    "form-action 'self'",
    `img-src ${imageSources.join(" ")}`,
    "manifest-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self'",
  ].join("; ");
}

export function outflowWebSecurity(environment = {}) {
  return {
    name: "outflow-web-security",
    apply: "build",
    enforce: "pre",
    transformIndexHtml() {
      const policy = webContentSecurityPolicy(environment);
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: policy },
          injectTo: "head-pre",
        },
        {
          tag: "meta",
          attrs: { name: "referrer", content: "no-referrer" },
          injectTo: "head-pre",
        },
      ];
    },
  };
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

export default defineConfig(({ mode }) => {
  const environment = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const publicBase = normalizePublicBase(environment.OUTFLOW_PUBLIC_BASE);
  const tauriDevHost = environment.TAURI_DEV_HOST;
  return {
    base: publicBase,
    plugins: [outflowWebSecurity({
      VITE_SUPABASE_URL: environment.VITE_SUPABASE_URL,
      TAURI_ENV_PLATFORM: environment.TAURI_ENV_PLATFORM,
    }), react(), outflowServiceWorker()],
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
  };
});
