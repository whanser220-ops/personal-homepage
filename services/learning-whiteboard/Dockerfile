# Build from the repository root:
# docker build -f services/learning-whiteboard/Dockerfile -t learning-whiteboard-mcp .
FROM node:24-bookworm-slim
RUN groupmod -g 1001 node && usermod -u 1001 -g 1001 node
WORKDIR /app
ENV NODE_ENV=production PORT=4310 HOST=0.0.0.0 WHITEBOARD_DATA_DIR=/app/data WHITEBOARD_SEED_DIR=/app/seed
COPY services/learning-whiteboard/package.json services/learning-whiteboard/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY services/learning-whiteboard/src ./src
COPY services/learning-whiteboard/test ./test
COPY public/articles/knowledge-map/software-atlas.excalidraw /app/seed/software-atlas.excalidraw
COPY public/articles/knowledge-map/regions.json /app/seed/regions.json
RUN npm test && mkdir -p /app/data && chown -R 1001:1001 /app/data
USER node
EXPOSE 4310
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:4310/whiteboard/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/http.js"]
