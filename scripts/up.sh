#!/bin/sh
# Start the whole stack in Docker.
#
#   npm run up               development: bind-mounted source, hot reload
#   npm run up -- --deploy   production: built image, detached, always restarted
set -e

if [ "$1" = "--deploy" ]; then
  exec docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
fi

exec docker compose up
