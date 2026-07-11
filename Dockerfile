FROM node:20-alpine

WORKDIR /app

# Cài dependencies trước để tận dụng cache layer.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Chép mã nguồn + tài nguyên tĩnh (HTML, support.js, maps/).
COPY . .

ENV PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    UPLOAD_DIR=/data/uploads

# Session + ảnh upload lưu trong volume để không mất khi rebuild container.
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
