FROM node:20-alpine
WORKDIR /app

ARG NEXT_PUBLIC_API=http://127.0.0.1:4000
ENV NEXT_PUBLIC_API=$NEXT_PUBLIC_API

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
