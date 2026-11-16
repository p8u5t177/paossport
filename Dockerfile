FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci

COPY client client
COPY server server
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

ENV NODE_ENV=production \
    PORT=3847 \
    DATA_DIR=/data \
    DATABASE_PATH=/data/app.db \
    MEDIA_ROOT=/data/media

EXPOSE 3847
CMD ["npm", "run", "start"]