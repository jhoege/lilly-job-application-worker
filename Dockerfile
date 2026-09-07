FROM mcr.microsoft.com/playwright:v1.55.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV BROWSER_PROFILE_PATH=/data/browser-profile

EXPOSE 3000

CMD ["npm", "start"]
