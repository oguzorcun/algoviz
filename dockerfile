# syntax=docker/dockerfile:1

# ---- Stage 1: build the static site ----
FROM node:22-alpine AS build
WORKDIR /app

# Copy only the dependency manifests first. This layer is reused as long as
# package.json and package-lock.json don't change.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source after the dependencies, so editing code only
# invalidates the layers from here down.
COPY . .
RUN npm run build

# ---- Stage 2: serve the built files ----
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
# nginx's default CMD starts the server, so none is needed here.