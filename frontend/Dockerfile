FROM node:20-alpine AS build

# Allow overriding the API base URL at build time.
# Default works for docker-compose; pass --build-arg VITE_API_URL=http://corp.localhost for K8s.
ARG VITE_API_URL=http://localhost:3001
ENV VITE_API_URL=$VITE_API_URL

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

# --- Production stage ---
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# React Router: serve index.html for all routes
RUN echo 'server { \
  listen 80; \
  root /usr/share/nginx/html; \
  index index.html; \
  location / { try_files $uri $uri/ /index.html; } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
