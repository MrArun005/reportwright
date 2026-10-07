# ReportWright: the app (designer, viewer, server renders, automation API) in one image.
#   docker build -t reportwright .
#   docker run -p 3000:3000 -e PW_BASIC_AUTH=admin:change-me -v pw-data:/app/data -v pw-reports:/app/reports reportwright
# Settings are the same environment variables as in the README (PW_AUTH, PW_STORAGE, PW_DB_<NAME>, …).
# PW_EMBED_ORIGINS is read at build time: pass it with --build-arg.
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG PW_EMBED_ORIGINS=
ENV PW_STANDALONE=1 PW_EMBED_ORIGINS=$PW_EMBED_ORIGINS
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/reports ./reports
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 3000
VOLUME ["/app/data", "/app/reports"]
# readyz: no key needed; 200 only when the storage answers and a render worker is ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/readyz').then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))"
# UV_THREADPOOL_SIZE: libuv's thread pool (PDF compression, files) is shared by every render thread; its default of 4
# queues their work. It is read before any code runs, so it is set here: the container's cores unless given.
CMD ["sh", "-c", "UV_THREADPOOL_SIZE=${UV_THREADPOOL_SIZE:-$(nproc)} exec node server.js"]
