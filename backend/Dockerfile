# 暖归平台后端镜像（NestJS + TypeORM）
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

RUN npm run build

# 容器启动：等待数据库就绪 → 首次启动自动建表并写入种子（之后重启保留数据）→ 启动服务
CMD ["sh", "-c", "node dist/scripts/ensure-seed.js && node dist/src/main.js"]
