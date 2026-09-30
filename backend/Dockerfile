FROM node:20-alpine
WORKDIR /app

# 依赖（含 ts-node，用于容器首启播种）
COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["docker-entrypoint.sh"]
