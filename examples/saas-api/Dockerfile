# The production image for this app: build with the full dependency set, ship `dist/`, the SQL migrations and the
# production dependencies only. Build from a copy of this directory that has its own `package-lock.json` (this folder
# lives in a workspace and has none): `npm install && docker build -t saas-api .`
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# `vendor/` exists only when the packages come from local tarballs (the CI check that builds this image); otherwise
# this copies nothing.
COPY vendor* ./vendor/
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The migration runner reads `migrations/` next to `dist/`; `blix run db:migrate` needs the config that points at the app.
COPY migrations ./migrations
COPY blix.config.ts package.json ./
USER node
EXPOSE 3000
# Apply migrations as a deploy step, once, with the same image and not from every replica:
#   docker run --rm -e DATABASE_URL=... -e JWT_SECRET=... saas-api npx blix run db:migrate
CMD ["node", "dist/main.js"]
