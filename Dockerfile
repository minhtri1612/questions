# The app is static files, so nginx only has to serve them.
FROM nginx:1.28-alpine
COPY . /usr/share/nginx/html/
