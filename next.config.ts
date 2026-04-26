import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["firebase-admin"],
  /**
   * Relaxes COOP so any remaining OAuth popup paths (or third-party scripts) are less likely
   * to hit `window.closed` / `window.close` warnings. Primary Google sign-in uses redirect.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
