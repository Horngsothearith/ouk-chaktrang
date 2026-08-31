# syntax=docker/dockerfile:1

# Node 22 matches the runtime the test suite targets (node --test, no framework).
FROM node:22-alpine

# The project has zero npm dependencies - no package.json, nothing to install.
# The whole app is vanilla JS served by a stdlib-only Node server, so the image
# is just the runtime plus source. That also means no build stage to multi-stage.
WORKDIR /app

COPY --chown=node:node . .

# node:alpine ships an unprivileged `node` user; don't run the server as root.
USER node

ENV PORT=5173
EXPOSE 5173

# Uses node rather than wget/curl: node is guaranteed present in this image,
# and busybox wget's flags vary between alpine releases.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||5173)+'/index.html',function(r){process.exit(r.statusCode===200?0:1)}).on('error',function(){process.exit(1)})"

CMD ["node", "scripts/dev-server.js"]
