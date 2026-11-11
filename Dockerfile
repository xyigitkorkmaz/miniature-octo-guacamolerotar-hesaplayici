FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=8788
EXPOSE 8788
CMD ["node", "server.js"]
