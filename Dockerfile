FROM node:20-bookworm-slim

# Install system dependencies: FFmpeg, FFprobe and CA certificates
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install all dependencies (including devDependencies required for Vite and TypeScript compilation)
RUN npm ci

# Copy application source code
COPY . .

# Compile frontend and bundle production server
RUN npm run build

# Prune devDependencies to keep container lean in production
RUN npm prune --omit=dev

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "dist/server.cjs"]
