import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import { geocodeDevFallback } from "./dev-geocode-plugin.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function rewriteRemoteSessionCookies(proxy: import("http-proxy").Server) {
  proxy.on("proxyRes", (proxyRes) => {
    const setCookie = proxyRes.headers["set-cookie"];
    if (!setCookie?.length) return;
    proxyRes.headers["set-cookie"] = setCookie.map((cookie) =>
      cookie.replace(/;\s*Secure/gi, "").replace(/;\s*Domain=[^;]+/gi, ""),
    );
  });
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const remoteApi = env.DEV_API_ORIGIN?.trim();
  const proxyTarget = remoteApi || "http://127.0.0.1:3847";
  const proxyCommon: ProxyOptions = {
    target: proxyTarget,
    changeOrigin: true,
    cookieDomainRewrite: "",
    secure: proxyTarget.startsWith("https"),
    ...(remoteApi ? { configure: rewriteRemoteSessionCookies } : {}),
  };

  return {
    plugins: [react(), tailwindcss(), ...(remoteApi ? [geocodeDevFallback()] : [])],
    server: {
      host: true,
      port: 3848,
      proxy: {
        "/api": proxyCommon,
        "/media": proxyCommon,
      },
    },
  };
});
