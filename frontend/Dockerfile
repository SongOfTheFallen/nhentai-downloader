FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_API_BASE_URL
ARG VITE_API_PASSWORD
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_API_PASSWORD=$VITE_API_PASSWORD
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx","-g","daemon off;"]
