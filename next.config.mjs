const nextConfig = {
  output: "standalone",
  async redirects() {
    return [
      { source: "/articles/event-driven-architecture-video", destination: "/articles/event-driven", permanent: true },
      { source: "/articles/event-driven-agent", destination: "/articles/event-driven", permanent: true },
    ];
  },
};

export default nextConfig;
