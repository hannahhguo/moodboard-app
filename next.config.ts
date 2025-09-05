import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "upload.wikimedia.org" },
      { protocol: "https", hostname: "live.staticflickr.com" },
      { protocol: "https", hostname: "farm*.staticflickr.com" },
      { protocol: "https", hostname: "images.unsplash.com" }, // optional future source
      { protocol: "https", hostname: "i0.wp.com" },           // some providers proxy
      { protocol: "https", hostname: "api.openverse.org" },
    ],
  },
};

export default nextConfig;