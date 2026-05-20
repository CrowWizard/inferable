# syntax = docker/dockerfile:1

ARG NODE_VERSION=20.11.1

FROM node:${NODE_VERSION}-slim AS base
WORKDIR /app

FROM base AS build
WORKDIR /build
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

COPY --link ./ /build

RUN npm ci

RUN npm run build
RUN npm prune --omit=dev

FROM base AS run

# Install curl for healthchecks
RUN apt-get update -qq && \
    apt-get install -y curl && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

ARG VERSION
ENV VERSION=$VERSION

ARG SHORT_VERSION
ENV SHORT_VERSION=$SHORT_VERSION

COPY --from=build /build/ /app

ENV NODE_ENV=production
ENV ENVIRONMENT=prod

EXPOSE 7000
CMD [ "npm", "run", "start" ]
