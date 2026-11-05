# One image for the three processes (api, app, agent); compose picks the command.
FROM oven/bun:1.4.0 AS bun

# eve (the agent runtime) requires Node.js 24 or newer.
FROM node:24-bookworm-slim AS build

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl git openssl \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -sf /usr/local/bin/bun /usr/local/bin/bunx

ENV CI=1 \
	CRM_TELEMETRY_DISABLED=1 \
	DO_NOT_TRACK=1 \
	NEXT_TELEMETRY_DISABLED=1 \
	TURBO_TELEMETRY_DISABLED=1

WORKDIR /repo
COPY . .

# Prisma's config needs a URL to load; nothing connects to it during the build.
ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public
# The app proxies /api/* and SSR calls to the API over the compose network.
ARG API_URL=http://api:3001
ENV DATABASE_URL=${DATABASE_URL} \
	API_URL=${API_URL} \
	NEXT_PUBLIC_API_URL=${API_URL}

RUN bun install --frozen-lockfile
RUN bun run build

ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	HOSTNAME=0.0.0.0 \
	NITRO_HOST=0.0.0.0

EXPOSE 3001 3060 2000

CMD ["sh", "-c", "echo 'Set the service command in docker-compose.openship.yml' && exit 1"]
