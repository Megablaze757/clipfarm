FROM jrottenberg/ffmpeg:7.1-alpine AS ffmpeg
FROM node:22-alpine

COPY --from=ffmpeg /usr/local /usr/local

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

EXPOSE 8080
CMD ["node", "dist/server.js"]
