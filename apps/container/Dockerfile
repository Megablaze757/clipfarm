# Clipper processing Container (spec §12). Runs on Cloudflare Containers.
# Alpine's ffmpeg build includes libx264, libass (burned captions) and freetype.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
RUN apk add --no-cache ffmpeg yt-dlp font-dejavu ca-certificates
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
ENV NODE_ENV=production PORT=8080 WORK_DIR=/tmp/clipper
EXPOSE 8080
CMD ["node", "dist/server.js"]
