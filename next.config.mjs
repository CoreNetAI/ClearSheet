/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the file-tracing root to this project. Without this, a stray
  // package-lock.json in the user's home folder makes Next.js infer the wrong
  // root and the build fails collecting traces (.nft.json ENOENT) on Windows.
  outputFileTracingRoot: import.meta.dirname,
  eslint: {
    // Lint runs as its own step (`npm run lint`); don't fail prod builds on it.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

// Enable Cloudflare bindings during `next dev` when the adapter is installed.
// No-op for plain Node dev; only activates if @opennextjs/cloudflare is present.
if (process.env.NODE_ENV === "development") {
  try {
    const { initOpenNextCloudflareForDev } = await import(
      "@opennextjs/cloudflare"
    );
    await initOpenNextCloudflareForDev();
  } catch {
    // adapter not installed / not needed for plain Node dev — ignore
  }
}
