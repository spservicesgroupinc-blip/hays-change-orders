import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["logo.svg"],
      manifest: {
        name: "Hays + Sons Change Orders",
        short_name: "Change Orders",
        description:
          "Create, price, and track itemized change orders from Xactimate estimates.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#dc2626",
        shortcuts: [
          {
            name: "Stored change orders",
            short_name: "Change orders",
            url: "/#/orders",
            icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
          },
          {
            name: "Job directory",
            short_name: "Jobs",
            url: "/#/jobs",
            icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
          },
        ],
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Only hashed assets are precached. The document is handled by the
        // network-first route below so a shell cached by an older deployment can
        // never ask for files the newest deployment has already pruned.
        globPatterns: ["**/*.{js,css,svg,png,ico,woff2}"],
        cleanupOutdatedCaches: true,
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) =>
              request.mode === "navigate" &&
              url.origin === self.location.origin,
            handler: "NetworkFirst",
            options: {
              cacheName: "hays-app-shell",
              networkTimeoutSeconds: 4,
            },
          },
        ],
      },
    }),
  ],
  server: { host: "127.0.0.1", port: 3010, strictPort: true },
});
