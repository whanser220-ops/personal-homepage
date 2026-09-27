const nextConfig = {
  output: "standalone",
  async redirects() {
    return [
      { source: "/articles/event-driven-architecture-video", destination: "/articles/event-driven-from-first-principles", permanent: true },
      { source: "/articles/event-driven-agent", destination: "/articles/event-driven-from-first-principles", permanent: true },
    ];
  },
};

export default nextConfig;
