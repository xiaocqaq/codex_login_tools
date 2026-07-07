FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/admin/package.json apps/admin/package.json
RUN npm ci

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/admin apps/admin
RUN npm run build -w @codex-login-tools/admin

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/admin/dist apps/admin/dist
COPY --from=build /app/apps/admin/public apps/admin/public
EXPOSE 18080
CMD ["npm", "run", "start", "-w", "@codex-login-tools/admin"]
