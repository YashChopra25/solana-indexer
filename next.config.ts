import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` loads optional native modules at runtime, which the bundler cannot
  // trace. Leaving it external keeps it a plain Node require.
  serverExternalPackages: ["pg"],
  allowedDevOrigins: ["16.58.93.201"],
};

export default nextConfig;
