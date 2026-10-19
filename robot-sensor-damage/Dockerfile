# 사내 서버로 옮길 때 쓰기 좋은 컨테이너 이미지
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY public ./public
COPY server ./server
ENV PORT=3000 HOST=0.0.0.0 DATA_DIR=/data APP_TZ=Asia/Seoul
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/app.js"]
