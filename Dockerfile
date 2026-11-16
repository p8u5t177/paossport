FROM node:22-alpine AS build
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci

COPY client client
COPY server server
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    DATABASE_PATH=/data/app.db \
    MEDIA_ROOT=/data/media

EXPOSE 3000
CMD ["node", "server/dist/index.js"]