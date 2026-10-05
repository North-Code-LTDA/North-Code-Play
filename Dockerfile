# Multi-stage build for pure static SPA web application
FROM node:20-alpine AS build

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies needed for build
RUN npm ci

# Copy source code and build production static files
COPY . .
RUN npm run build

# Pure static Nginx server without any backend proxy, ffmpeg or node server
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
