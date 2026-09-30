# 暖归平台前端镜像（Next.js 14 App Router，独立模式）
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 浏览器访问后端的地址（宿主机映射的 4000 端口）
ARG NEXT_PUBLIC_API=http://localhost:4000
ENV NEXT_PUBLIC_API=$NEXT_PUBLIC_API
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.js ./next.config.js
EXPOSE 3000
CMD ["npm", "run", "start"]
